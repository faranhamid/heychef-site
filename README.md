# HeyChef! - AI-Powered Recipe Generator

A subscription-based AI recipe generator with Stripe payment integration.

## Features

- 🔐 Google Firebase Authentication
- 💳 Stripe Subscription Management
- 🤖 AI-Powered Recipe Generation
- 📱 Responsive Design
- 🔄 Real-time Subscription Status

## Setup Instructions

### 1. Frontend Setup

The frontend is already configured and ready to use. It's deployed on Netlify at `heychef.menu`.

### 2. Backend Setup (Required for Stripe Integration)

#### Prerequisites
- Node.js (v14 or higher)
- npm or yarn
- Stripe account

#### Installation

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Create environment file:**
   ```bash
   cp env.example .env
   ```

3. **Configure Stripe:**
   - Get your Stripe Secret Key from [Stripe Dashboard](https://dashboard.stripe.com/apikeys)
   - Add it to `.env`:
     ```
     STRIPE_SECRET_KEY=sk_test_your_key_here
     ```

4. **Set up Stripe Webhook:**
   - Go to [Stripe Webhooks](https://dashboard.stripe.com/webhooks)
   - Add endpoint: `https://your-domain.com/api/webhook`
   - Select events: `customer.subscription.deleted`, `customer.subscription.updated`, `invoice.payment_succeeded`, `invoice.payment_failed`
   - Copy the webhook secret to `.env`:
     ```
     STRIPE_WEBHOOK_SECRET=whsec_your_webhook_secret_here
     ```

5. **Start the server:**
   ```bash
   npm start
   ```

### 3. Deployment

#### Option A: Deploy to Heroku
1. Create a Heroku app
2. Set environment variables in Heroku dashboard
3. Deploy:
   ```bash
   git push heroku main
   ```

#### Option B: Deploy to Railway
1. Connect your GitHub repo to Railway
2. Set environment variables
3. Deploy automatically

#### Option C: Deploy to Vercel
1. Install Vercel CLI: `npm i -g vercel`
2. Deploy: `vercel`

### 4. Update Frontend API URL

Once your backend is deployed, update the API calls in `index.html` to point to your backend URL:

```javascript
// Replace with your backend URL
const API_BASE_URL = 'https://your-backend-url.com';

// Update fetch calls
const response = await fetch(`${API_BASE_URL}/api/unsubscribe`, {
    // ... rest of the code
});
```

## Stripe Integration Features

### Subscription Management
- ✅ Real-time subscription status checking
- ✅ Proper subscription cancellation via Stripe API
- ✅ Webhook handling for subscription events
- ✅ Graceful fallback to local status if backend unavailable

### User Experience
- ✅ Loading states during API calls
- ✅ Error handling with retry options
- ✅ Success confirmations
- ✅ Automatic UI updates after actions

## File Structure

```
Hey-chef-site/
├── index.html          # Main frontend file
├── style.css           # Styles
├── server.js           # Backend server
├── package.json        # Node.js dependencies
├── env.example         # Environment variables template
├── images/             # Static images
└── README.md           # This file
```

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `STRIPE_SECRET_KEY` | Your Stripe secret key | Yes |
| `STRIPE_WEBHOOK_SECRET` | Webhook endpoint secret | Yes |
| `PORT` | Server port (default: 3001) | No |

## API Endpoints

- `POST /api/unsubscribe` - Cancel user subscription
- `POST /api/subscription-status` - Check subscription status
- `POST /api/webhook` - Stripe webhook handler
- `GET /api/health` - Health check

## Troubleshooting

### Common Issues

1. **"Customer not found in Stripe"**
   - Ensure the user has completed a payment through Stripe
   - Check that the email matches the Stripe customer email

2. **"No active subscriptions found"**
   - Verify the subscription is still active in Stripe dashboard
   - Check if the subscription was already cancelled

3. **Webhook errors**
   - Verify webhook secret is correct
   - Ensure webhook endpoint is accessible
   - Check webhook event types are selected

### Support

For issues or questions, contact: support@heychef.com 