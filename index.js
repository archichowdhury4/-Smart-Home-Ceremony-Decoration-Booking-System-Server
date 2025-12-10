const express = require("express");
const cors = require('cors');
const { MongoClient, ServerApiVersion } = require('mongodb');
const app = express()
require('dotenv').config()
const port = process.env.PORT || 3000;

// middleware
app.use(cors());
app.use(express.json());





const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.vvoht34.mongodb.net/?appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    const db = client.db("smart_home_db")
    const servicesCollection = db.collection("services");
    const bookingsCollection = db.collection("bookings");


    // services api
    app.get("/services", async (req, res) => {
  const result = await servicesCollection.find().toArray();
  res.send(result);
});


// Insert
     app.post("/services", async(req,res) =>{
        const service =req.body;
        const result = await servicesCollection.insertOne(service);
        res.send(result);
    })

// top-services api
  app.get("/top-services", async (req, res) => {
  const topServices = await servicesCollection
    .find()
    .sort({ rating: -1 })
    .limit(6)
    .toArray();

  res.send(topServices);
});

// details api
app.get("/services/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  const result = await servicesCollection.findOne({ id: id });
  res.send(result);
});


    // POST booking
    app.post("/bookings", async (req, res) => {
      const booking = req.body;
      const result = await bookingsCollection.insertOne(booking);
      res.send(result);
    });

//      app.get("/bookings", async (req, res) => {
//   const result = await bookingsCollection.find().toArray();
//   res.send(result);
// });

    app.get("/bookings", async (req, res) => {
    const query = {};
    const {email} = req.query
    if (email) {
      query.userEmail = email;
    }
    const cursor = bookingsCollection.find(query);
    const result = await cursor.toArray()
    res.send(result);
});


    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get('/', (req, res) => {
  res.send('Smart home server is running ')
})

app.listen(port, () => {
  console.log(`Smart home server is running on port ${port}`)
})