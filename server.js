const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
require('dotenv').config();

// Whop API configuration
const WHOP_API_KEY = 'Xj86QOr3N_9DVUuNm2Ezlh2YrHuwmYJdqAMCM4n299E';
const WHOP_API_BASE = 'https://api.whop.com/api/v2';

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
        
        console.log('🔍 Backend: Checking Whop subscription for email:', email);
        
        if (!email) {
            console.log('❌ Backend: No email provided');
            return res.status(400).json({ error: 'Email is required' });
        }

        // Check Whop API for user subscription
        try {
            console.log('🔍 Backend: Checking Whop API for user:', email);
            
            // First, get the user from Whop API
            const userResponse = await fetch(`${WHOP_API_BASE}/users?email=${encodeURIComponent(email)}`, {
                headers: {
                    'Authorization': `Bearer ${WHOP_API_KEY}`,
                    'Content-Type': 'application/json'
                }
            });

            if (!userResponse.ok) {
                console.log('❌ Backend: Whop API error:', userResponse.status);
                return res.json({ subscribed: false, paymentConfirmed: false });
            }

            const userData = await userResponse.json();
            console.log('🔍 Backend: Whop user data:', userData);

            if (!userData.data || userData.data.length === 0) {
                console.log('❌ Backend: No Whop user found for email:', email);
                return res.json({ subscribed: false, paymentConfirmed: false });
            }

            const user = userData.data[0];
            console.log('🔍 Backend: Found Whop user:', user.id);

            // Check if user has active access to your product
            const accessResponse = await fetch(`${WHOP_API_BASE}/users/${user.id}/access`, {
                headers: {
                    'Authorization': `Bearer ${WHOP_API_KEY}`,
                    'Content-Type': 'application/json'
                }
            });

            if (!accessResponse.ok) {
                console.log('❌ Backend: Whop access API error:', accessResponse.status);
                return res.json({ subscribed: false, paymentConfirmed: false });
            }

            const accessData = await accessResponse.json();
            console.log('🔍 Backend: Whop access data:', accessData);

            // Check if user has active access to HeyChef
            const hasActiveAccess = accessData.data && accessData.data.some(access => 
                access.status === 'active' && 
                (access.product_name === 'HeyChef!' || access.product_id)
            );

            if (hasActiveAccess) {
                console.log('✅ Backend: User has active Whop access - granting access');
                return res.json({
                    subscribed: true,
                    paymentConfirmed: true,
                    status: 'active',
                    provider: 'whop'
                });
            } else {
                console.log('❌ Backend: User does not have active Whop access');
                return res.json({ subscribed: false, paymentConfirmed: false });
            }

        } catch (whopError) {
            console.error('❌ Backend: Error checking Whop subscription:', whopError);
            return res.json({ subscribed: false, paymentConfirmed: false });
        }

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