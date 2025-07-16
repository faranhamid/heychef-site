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
        
        if (!email) {
            return res.status(400).json({ error: 'Email is required' });
        }

        // Find the customer in Stripe by email
        const customers = await stripe.customers.list({
            email: email,
            limit: 1
        });

        if (customers.data.length === 0) {
            return res.json({ subscribed: false });
        }

        const customer = customers.data[0];

        // Get active subscriptions
        const subscriptions = await stripe.subscriptions.list({
            customer: customer.id,
            status: 'active'
        });

        if (subscriptions.data.length === 0) {
            return res.json({ subscribed: false });
        }

        const subscription = subscriptions.data[0];
        
        res.json({
            subscribed: true,
            subscriptionId: subscription.id,
            status: subscription.status,
            currentPeriodEnd: subscription.current_period_end,
            cancelAtPeriodEnd: subscription.cancel_at_period_end
        });

    } catch (error) {
        console.error('Error checking subscription status:', error);
        res.status(500).json({ error: 'Failed to check subscription status' });
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
            // Handle successful payments
            break;
            
        case 'invoice.payment_failed':
            const failedInvoice = event.data.object;
            console.log('Payment failed:', failedInvoice.id);
            // Handle failed payments
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