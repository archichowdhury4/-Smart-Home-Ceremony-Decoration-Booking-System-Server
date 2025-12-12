require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ObjectId, ServerApiVersion } = require("mongodb");
const stripe = require("stripe")(process.env.STRIPE_SECRET);

const app = express();
const port = process.env.PORT || 3000;

const admin = require("firebase-admin");

const serviceAccount = require("path/to/serviceAccountKey.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});


// Middleware
app.use(cors());
app.use(express.json());

const verifyFBToken = async (req, res, next) => {
  console.log("header in middleware", req.headers.authorization)
    const token = req.headers.authorization;

    if (!token) {
        return res.status(401).send({ message: 'unauthorized access' })
    }

    // try {
    //     const idToken = token.split(' ')[1];
    //     const decoded = await admin.auth().verifyIdToken(idToken);
    //     console.log('decoded in the token', decoded);
    //     req.decoded_email = decoded.email;
    //     next();
    // }
    // catch (err) {
    //     return res.status(401).send({ message: 'unauthorized access' })
    // }


}

// MongoDB Connection
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.vvoht34.mongodb.net/?appName=Cluster0`;
const client = new MongoClient(uri, {
  serverApi: { version: ServerApiVersion.v1, strict: true, deprecationErrors: true },
});

async function run() {
  try {
    await client.connect();
    const db = client.db("smart_home_db");

    const servicesCollection = db.collection("services");
    const bookingsCollection = db.collection("bookings");
    const usersCollection = db.collection("users");
    const paymentsCollection = db.collection("payments"); // New collection for payment history

    /** ------------------ SERVICES ------------------ **/
    app.get("/services", async (req, res) => {
      const services = await servicesCollection.find().toArray();
      res.send(services);
    });

    app.get("/top-services", async (req, res) => {
      const topServices = await servicesCollection.find().sort({ rating: -1 }).limit(6).toArray();
      res.send(topServices);
    });

    app.get("/services/:id", async (req, res) => {
      const service = await servicesCollection.findOne({ _id: new ObjectId(req.params.id) });
      res.send(service);
    });

    /** ------------------ BOOKINGS ------------------ **/
    app.post("/bookings", async (req, res) => {
      const booking = { ...req.body, paymentStatus: "unpaid", createdAt: new Date() };
      const result = await bookingsCollection.insertOne(booking);
      res.send(result);
    });

    app.get("/bookings", async (req, res) => {
      const query = req.query.email ? { userEmail: req.query.email } : {};
      const bookings = await bookingsCollection.find(query).toArray();
      res.send(bookings);
    });

    app.get("/bookings/:id", async (req, res) => {
      const booking = await bookingsCollection.findOne({ _id: new ObjectId(req.params.id) });
      res.send(booking);
    });

    app.delete("/bookings/:id", async (req, res) => {
      const result = await bookingsCollection.deleteOne({ _id: new ObjectId(req.params.id) });
      res.send(result);
    });

    /** ------------------ USERS ------------------ **/
    app.post("/users", async (req, res) => {
      const user = req.body;
      if (!user.email) return res.status(400).send({ success: false, message: "Email required" });

      const existingUser = await usersCollection.findOne({ email: user.email });
      if (existingUser) return res.send({ success: true, message: "User already exists", user: existingUser });

      const result = await usersCollection.insertOne({ ...user, createdAt: new Date() });
      res.send({ success: true, message: "User added", result });
    });

    app.get("/users", async (req, res) => {
      const users = await usersCollection.find().toArray();
      res.send(users);
    });

    /** ------------------ STRIPE PAYMENT ------------------ **/
    app.post("/create-checkout-session", async (req, res) => {
      const { price, serviceName, userEmail, bookingId } = req.body;
      if (!price || !serviceName || !userEmail || !bookingId) {
        return res.status(400).send({ error: "Missing payment info" });
      }

      try {
        const session = await stripe.checkout.sessions.create({
          line_items: [
            {
              price_data: {
                currency: "usd",
                product_data: { name: serviceName },
                unit_amount: price * 100,
              },
              quantity: 1,
            },
          ],
          mode: "payment",
          customer_email: userEmail,
          success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?bookingId=${bookingId}`,
          cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`,
        });

        res.send({ url: session.url });
      } catch (err) {
        console.error("Stripe error:", err.message);
        res.status(500).send({ error: "Stripe session failed" });
      }
    });

    /** ------------------ PAYMENT SUCCESS ------------------ **/
    app.patch("/payment-success/:bookingId", async (req, res) => {
      const { bookingId } = req.params;

      try {
        // Update booking status
        const updateBooking = await bookingsCollection.updateOne(
          { _id: new ObjectId(bookingId) },
          { $set: { paymentStatus: "paid", paidAt: new Date() } }
        );

        if (updateBooking.modifiedCount === 0) return res.status(404).send({ message: "Booking not found" });

        // Save payment history
        const booking = await bookingsCollection.findOne({ _id: new ObjectId(bookingId) });
        await paymentsCollection.insertOne({
          bookingId,
          userEmail: booking.userEmail,
          serviceName: booking.serviceName,
          amount: booking.price,
          paidAt: new Date(),
        });

        res.send({ message: "Payment updated & saved successfully" });
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: "Server error" });
      }
    });

    /** ------------------ PAYMENT HISTORY ------------------ **/
    app.get("/payments",verifyFBToken, async (req, res) => {
      const email = req.query.email;
      const query = {}
      console.log("headers",req.headers)
      if(email){
        query.userEmail =email
      }
      const cursor = paymentsCollection.find(query);
      const result = await cursor.toArray();
      res.send(result)

      // const payments = await paymentsCollection.find({ userEmail: email }).sort({ paidAt: -1 }).toArray();
      // res.send(payments);
    });

    console.log("MongoDB connected successfully!");
  } finally {
    // Do not close client
  }
}

run().catch(console.dir);

/** ------------------ ROOT ------------------ **/
app.get("/", (req, res) => res.send("Smart home server running..."));
app.listen(port, () => console.log(`Server running on port ${port}`));
