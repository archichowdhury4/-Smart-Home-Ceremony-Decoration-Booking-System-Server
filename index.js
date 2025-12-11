require('dotenv').config();    
const express = require("express");
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const stripe = require('stripe')(process.env.STRIPE_SECRET);

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.vvoht34.mongodb.net/?appName=Cluster0`;
const client = new MongoClient(uri, {
  serverApi: { version: ServerApiVersion.v1, strict: true, deprecationErrors: true }
});

async function run() {
  try {
    await client.connect();
    const db = client.db("smart_home_db");
    const servicesCollection = db.collection("services");
    const bookingsCollection = db.collection("bookings");

    // Services API
    app.get("/services", async (req, res) => {
      const result = await servicesCollection.find().toArray();
      res.send(result);
    });

    app.get("/top-services", async (req, res) => {
      const topServices = await servicesCollection.find().sort({ rating: -1 }).limit(6).toArray();
      res.send(topServices);
    });

    app.get("/services/:id", async (req, res) => {
      const id = req.params.id;
      const result = await servicesCollection.findOne({ _id: new ObjectId(id) });
      res.send(result);
    });

    // Bookings API
    app.post("/bookings", async (req, res) => {
      const result = await bookingsCollection.insertOne(req.body);
      res.send(result);
    });

    app.get("/bookings", async (req, res) => {
      const query = {};
      if (req.query.email) query.userEmail = req.query.email;
      const result = await bookingsCollection.find(query).toArray();
      res.send(result);
    });

    app.delete("/bookings/:id", async (req, res) => {
      const result = await bookingsCollection.deleteOne({ _id: new ObjectId(req.params.id) });
      res.send(result);
    });

    // Payment with Stripe (full error handling)
    app.post('/create-checkout-session', async (req, res) => {
      try {
        const paymentInfo = req.body;

        if (!paymentInfo.price || !paymentInfo.serviceName || !paymentInfo.userEmail) {
          return res.status(400).send({ error: 'Missing payment info' });
        }

        const session = await stripe.checkout.sessions.create({
          line_items: [
            {
              price_data: {
                currency: "usd",
                product_data: { name: paymentInfo.serviceName },
                unit_amount: paymentInfo.price * 100,
              },
              quantity: 1,
            },
          ],
          customer_email: paymentInfo.userEmail,
          mode: 'payment',
          metadata: { bookingId: paymentInfo.bookingId },
          success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success`,
          cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`,
        });

        res.send({ url: session.url });
      } catch (err) {
        console.error('Stripe payment error:', err.message);
        res.status(500).send({ error: 'Payment failed', details: err.message });
      }
    });

    // Ping test
    await client.db("admin").command({ ping: 1 });
    console.log("Connected to MongoDB successfully!");
  } finally {
    // Do not close client during server run
  }
}
run().catch(console.dir);

app.get('/', (req, res) => res.send('Smart home server is running'));
app.listen(port, () => console.log(`Server running on port ${port}`));
