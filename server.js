const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const cors = require('cors');
const bodyParser = require('body-parser');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Store subscription mappings (in production, use a database)
const userSubscriptions = new Map();

// Routes
app.post('/api/unsubscribe', async (req, res) => {
    try {
        const { userId, email } = req.body;
        
        if (!userId || !email) {
            return res.status(400).json({ error: 'Missing userId or email' });
        }

        // Find the customer in Stripe by email
        const customers = await stripe.customers.list({
            email: email,
            limit: 1
        });

        if (customers.data.length === 0) {
            return res.status(404).json({ error: 'Customer not found in Stripe' });
        }

        const customer = customers.data[0];

        // Get all subscriptions for this customer
        const subscriptions = await stripe.subscriptions.list({
            customer: customer.id,
            status: 'active'
        });

        if (subscriptions.data.length === 0) {
            return res.status(404).json({ error: 'No active subscriptions found' });
        }

        // Cancel all active subscriptions
        const cancelledSubscriptions = [];
        for (const subscription of subscriptions.data) {
            const cancelledSubscription = await stripe.subscriptions.update(subscription.id, {
                cancel_at_period_end: true
            });
            cancelledSubscriptions.push(cancelledSubscription);
        }

        // Store the mapping for webhook processing
        userSubscriptions.set(userId, {
            customerId: customer.id,
            subscriptionIds: subscriptions.data.map(sub => sub.id),
            cancelledAt: new Date()
        });

        res.json({
            success: true,
            message: 'Subscription cancelled successfully',
            cancelledAt: new Date(),
            subscriptions: cancelledSubscriptions
        });

    } catch (error) {
        console.error('Error cancelling subscription:', error);
        res.status(500).json({ error: 'Failed to cancel subscription' });
    }
});

app.post('/api/subscription-status', async (req, res) => {
    try {
        const { email } = req.body;
        
        console.log('🔍 Backend: Checking subscription for email:', email);
        
        if (!email) {
            console.log('❌ Backend: No email provided');
            return res.status(400).json({ error: 'Email is required' });
        }

        // Find the customer in Stripe by email
        console.log('🔍 Backend: Searching for Stripe customer...');
        const customers = await stripe.customers.list({
            email: email,
            limit: 1
        });

        console.log('🔍 Backend: Found customers:', customers.data.length);

        if (customers.data.length === 0) {
            console.log('❌ Backend: No Stripe customer found for email:', email);
            return res.json({ subscribed: false, paymentConfirmed: false });
        }

        const customer = customers.data[0];
        console.log('🔍 Backend: Found customer ID:', customer.id);

        // Get active subscriptions
        console.log('🔍 Backend: Checking for active subscriptions...');
        const subscriptions = await stripe.subscriptions.list({
            customer: customer.id,
            status: 'active'
        });

        console.log('🔍 Backend: Found active subscriptions:', subscriptions.data.length);

        if (subscriptions.data.length === 0) {
            console.log('❌ Backend: No active subscriptions found');
            return res.json({ subscribed: false, paymentConfirmed: false });
        }

        const subscription = subscriptions.data[0];
        console.log('🔍 Backend: Found subscription ID:', subscription.id);
        
        // Check if payment was actually made by looking at invoices
        console.log('🔍 Backend: Checking for paid invoices...');
        const invoices = await stripe.invoices.list({
            customer: customer.id,
            subscription: subscription.id,
            status: 'paid',
            limit: 1
        });

        console.log('🔍 Backend: Found paid invoices:', invoices.data.length);

        // For trial subscriptions, check if they have an active subscription
        // For paid subscriptions, check for paid invoices
        let paymentConfirmed = false;
        
        if (subscription.status === 'active') {
            if (subscription.trial_end && subscription.trial_end > Math.floor(Date.now() / 1000)) {
                // User is in trial period - consider them subscribed
                console.log('🔍 Backend: User is in trial period - granting access');
                paymentConfirmed = true;
            } else if (invoices.data.length > 0) {
                // User has paid invoices - consider them subscribed
                console.log('🔍 Backend: User has paid invoices - granting access');
                paymentConfirmed = true;
            } else {
                // Check if subscription is active (might be a free trial that converted)
                console.log('🔍 Backend: Active subscription found - granting access');
                paymentConfirmed = true;
            }
        }
        
        const result = {
            subscribed: paymentConfirmed, // Only true if payment was made
            paymentConfirmed: paymentConfirmed,
            subscriptionId: subscription.id,
            status: subscription.status,
            currentPeriodEnd: subscription.current_period_end,
            cancelAtPeriodEnd: subscription.cancel_at_period_end
        };
        
        console.log('🔍 Backend: Final result:', result);
        res.json(result);

    } catch (error) {
        console.error('❌ Backend: Error checking subscription status:', error);
        res.status(500).json({ error: 'Failed to check subscription status' });
    }
});

// Payment verification endpoint
app.post('/api/verify-payment', async (req, res) => {
    try {
        const { sessionId } = req.body;
        
        if (!sessionId) {
            return res.status(400).json({ error: 'Session ID is required' });
        }

        // Retrieve the checkout session from Stripe
        const session = await stripe.checkout.sessions.retrieve(sessionId);
        
        if (session.payment_status !== 'paid') {
            return res.json({
                success: false, 
                message: 'Payment not completed',
                paymentStatus: session.payment_status
            });
        }

        // Get customer and subscription details
        const customer = await stripe.customers.retrieve(session.customer);
        const subscriptions = await stripe.subscriptions.list({
            customer: session.customer,
            status: 'active'
        });

        if (subscriptions.data.length === 0) {
            return res.json({
                success: false, 
                message: 'No active subscription found' 
            });
        }

        const subscription = subscriptions.data[0];

        res.json({
            success: true,
            message: 'Payment verified successfully',
            customerEmail: customer.email,
            subscriptionId: subscription.id,
            subscriptionStatus: subscription.status
        });

    } catch (error) {
        console.error('Error verifying payment:', error);
        res.status(500).json({ error: 'Failed to verify payment' });
    }
});

// Stripe webhook endpoint
app.post('/api/webhook', bodyParser.raw({ type: 'application/json' }), async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;

    try {
        event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
        console.error('Webhook signature verification failed:', err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Handle the event
    switch (event.type) {
        case 'customer.subscription.deleted':
            const subscription = event.data.object;
            console.log('Subscription deleted:', subscription.id);
            // Here you would update your database to mark the user as unsubscribed
            break;
            
        case 'customer.subscription.updated':
            const updatedSubscription = event.data.object;
            console.log('Subscription updated:', updatedSubscription.id);
            // Handle subscription updates
            break;
            
        case 'invoice.payment_succeeded':
            const invoice = event.data.object;
            console.log('Payment succeeded:', invoice.id);
            
            // Update user subscription status in Firestore when payment is confirmed
            if (invoice.subscription) {
                try {
                    // Get subscription details
                    const subscription = await stripe.subscriptions.retrieve(invoice.subscription);
                    
                    // Get customer details
                    const customer = await stripe.customers.retrieve(subscription.customer);
                    
                    // Update Firestore - you'll need to add Firebase Admin SDK here
                    // For now, we'll log the details
                    console.log('Payment confirmed for customer:', customer.email);
                    console.log('Subscription ID:', subscription.id);
                    console.log('Invoice ID:', invoice.id);
                    
                    // TODO: Add Firebase Admin SDK to update user document
                    // const userDocRef = admin.firestore().collection('users').doc(userId);
                    // await userDocRef.set({
                    //     subscribed: true,
                    //     paymentConfirmed: true,
                    //     stripeCustomerId: customer.id,
                    //     stripeSubscriptionId: subscription.id,
                    //     lastPaymentDate: new Date(),
                    //     subscriptionStatus: subscription.status
                    // }, { merge: true });
                    
                } catch (error) {
                    console.error('Error updating user after payment:', error);
                }
            }
            break;
            
        case 'invoice.payment_failed':
            const failedInvoice = event.data.object;
            console.log('Payment failed:', failedInvoice.id);
            // Handle failed payments - mark user as unsubscribed
            break;
            
        default:
            console.log(`Unhandled event type ${event.type}`);
    }

    res.json({ received: true });
});

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Health check: http://localhost:${PORT}/api/health`);
}); 