require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const stripe = require("stripe")(process.env.STRIPE_SECRET);

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

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

    // Service api

    app.get("/services", async (req, res) => {
      const result = await servicesCollection.find().toArray();
      res.send(result);
    });

    app.get("/top-services", async (req, res) => {
      const result = await servicesCollection.find().sort({ rating: -1 }).limit(6).toArray();
      res.send(result);
    });

    app.get("/services/:id", async (req, res) => {
      const id = req.params.id;
      const result = await servicesCollection.findOne({ _id: new ObjectId(id) });
      res.send(result);
    });

    //  BOOKINGS APIs 

    app.post("/bookings", async (req, res) => {
      const result = await bookingsCollection.insertOne({
        ...req.body,
        paymentStatus: "unpaid",
      });
      res.send(result);
    });

    app.get("/bookings", async (req, res) => {
      const query = {};
      if (req.query.email) query.userEmail = req.query.email;

      const result = await bookingsCollection.find(query).toArray();
      res.send(result);
    });

    app.get("/bookings/:id", async (req, res) => {
      const id = req.params.id;
      const result = await bookingsCollection.findOne({ _id: new ObjectId(id) });
      res.send(result);
    });

    app.delete("/bookings/:id", async (req, res) => {
      const result = await bookingsCollection.deleteOne({ _id: new ObjectId(req.params.id) });
      res.send(result);
    });

    //  USERS APIs 

    app.post("/users", async (req, res) => {
      const user = req.body;

      if (!user.email) {
        return res.status(400).send({ success: false, message: "Email is required!" });
      }

      const existingUser = await usersCollection.findOne({ email: user.email });
      if (existingUser) {
        return res.send({ success: true, message: "User already exists", user: existingUser });
      }

      const result = await usersCollection.insertOne({
        name: user.name,
        email: user.email,
        image: user.image || "",
        createdAt: new Date(),
      });

      res.send({ success: true, message: "User added", result });
    });

    app.get("/users", async (req, res) => {
      const users = await usersCollection.find().toArray();
      res.send(users);
    });

  //  STRIPE PAYMENT 

    app.post("/create-checkout-session", async (req, res) => {
      try {
        const info = req.body;

        if (!info.price || !info.serviceName || !info.userEmail) {
          return res.status(400).send({ error: "Missing payment info" });
        }

        const session = await stripe.checkout.sessions.create({
          line_items: [
            {
              price_data: {
                currency: "usd",
                product_data: { name: info.serviceName },
                unit_amount: info.price * 100,
              },
              quantity: 1,
            },
          ],
          customer_email: info.userEmail,
          mode: "payment",

          success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?bookingId=${info.bookingId}`,
          cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`,
        });

        res.send({ url: session.url });
      } catch (error) {
        console.error(error.message);
        res.status(500).send({ error: "Stripe session failed" });
      }
    });

    //  PAYMENT SUCCESS UPDATE

    app.patch("/payment-success/:bookingId", async (req, res) => {
      const bookingId = req.params.bookingId;

      try {
        const result = await bookingsCollection.updateOne(
          { _id: new ObjectId(bookingId) },
          { $set: { paymentStatus: "paid", paidAt: new Date() } }
        );

        if (result.modifiedCount === 0) {
          return res.status(404).send({ message: "Booking not found" });
        }

        res.send({ message: "Payment updated successfully!" });
      } catch (err) {
        res.status(500).send({ message: "Server error" });
      }
    });

    console.log("MongoDB connected ✔");
  } finally {}
}

run().catch(console.dir);

app.get("/", (req, res) => res.send("Smart home server running..."));
app.listen(port, () => console.log(`Server running on port ${port}`));
