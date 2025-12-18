require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ObjectId, ServerApiVersion } = require("mongodb");
const stripe = require("stripe")(process.env.STRIPE_SECRET);

const app = express();
const port = process.env.PORT || 3000;

const admin = require("firebase-admin");

const serviceAccount = require("./smart-home-ceremony-decoration-firebase-adminsdk.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});


// Middleware
app.use(cors());
app.use(express.json());

const verifyFBToken = async (req, res, next) => {
  // console.log("header in middleware", req.headers.authorization)
    const token = req.headers.authorization;

    if (!token) {
        return res.status(401).send({ message: 'unauthorized access' })
    }

    try {
        const idToken = token.split(' ')[1];
        const decoded = await admin.auth().verifyIdToken(idToken);
        console.log('decoded in the token', decoded);
        req.decoded_email = decoded.email;
        next();
    }
    catch (err) {
        return res.status(401).send({ message: 'unauthorized access' })
    }


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
    const paymentsCollection = db.collection("payments"); 
    const decoratorsCollection = db.collection("decorators"); 

    const verifyAdmin = async (req, res, next) => {
  const email = req.decoded_email;
  if (!email) {
    return res.status(401).send({ message: "unauthorized" });
  }

  const user = await usersCollection.findOne({ email });
  if (!user || user.role !== 'admin') {
    return res.status(403).send({ message: 'forbidden access' });
  }

  next();
};

    //  SERVICES 
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
  app.post("/services", async(req, res) => {
  const service = req.body;  
  service.status = service.status || "active";
  service.createdAt = new Date();

  const result = await servicesCollection.insertOne(service);
  res.send(result);
});

app.patch("/services/:id", async (req, res) => {
  const id = req.params.id;
  const updatedData = req.body;

  const result = await servicesCollection.updateOne(
    { _id: new ObjectId(id) },
    { $set: updatedData }
  );

  res.send(result);
});


app.delete("/services/:id", async (req, res) => {
  const id = req.params.id;

  const result = await servicesCollection.deleteOne({ _id: new ObjectId(id) });
  res.send(result);
});


    //  BOOKINGS 
 app.post("/bookings", async (req, res) => {
  try {
    const { date, userName, userEmail, serviceName, serviceType, price, phone, address, message } = req.body;

    if (!date) return res.status(400).send({ message: "Date is required" });

    // eventDate properly Date object e convert kora
    const eventDate = new Date(date);
    if (isNaN(eventDate.getTime())) return res.status(400).send({ message: "Invalid date" });

    const booking = {
      userName,
      userEmail,
      serviceName,
      serviceType,
      price,
      phone,
      address,
      message: message || "",
      date, 
      eventDate, 
      paymentStatus: "unpaid",
      createdAt: new Date()
    };

    const result = await bookingsCollection.insertOne(booking);
    res.send(result);

  } catch (err) {
    console.error(err);
    res.status(500).send({ message: "Server error" });
  }
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

    app.patch("/bookings/:id", async (req, res) => {
  const id = req.params.id;
  const updatedData = req.body; 

  const result = await bookingsCollection.updateOne(
    { _id: new ObjectId(id) },
    { $set: updatedData }
  );

  res.send(result);
});


    app.delete("/bookings/:id", async (req, res) => {
      const result = await bookingsCollection.deleteOne({ _id: new ObjectId(req.params.id) });
      res.send(result);
    });

app.patch(
  "/bookings/:id/assign-decorator",
  verifyFBToken,
  verifyAdmin,
  async (req, res) => {

    const { decoratorEmail } = req.body;

    const decorator = await decoratorsCollection.findOne({
      email: decoratorEmail,
      workStatus: "available"
    });

    if (!decorator) {
      return res.status(400).send({ message: "Decorator not available" });
    }

    await decoratorsCollection.updateOne(
      { email: decoratorEmail },
      { $set: { workStatus: "busy" } }
    );

    const result = await bookingsCollection.updateOne(
      { _id: new ObjectId(req.params.id) },
      {
        $set: {
          decoratorAssigned: {
            decoratorId: decorator._id,
            decoratorName: decorator.name,
            decoratorEmail,
            assignedAt: new Date()
          },
          status: "assigned",
          updatedAt: new Date()
        }
      }
    );

    res.send(result);
  }
);

// admin/revenue route
app.get("/admin/revenue", async (req, res) => {
  try {
    const bookings = await bookingsCollection.find().toArray();

    const totalRevenue = bookings
      .filter(b => b.paymentStatus === "paid")
      .reduce((sum, b) => sum + b.price, 0);

    const totalPaidBookings = bookings.filter(b => b.paymentStatus === "paid").length;
    const totalBookings = bookings.length;
    const totalUnpaidBookings = bookings.filter(b => b.paymentStatus !== "paid").length;

    res.send({
      totalRevenue,
      totalPaidBookings,
      totalBookings,
      totalUnpaidBookings
    });
  } catch (err) {
    console.error(err);
    res.status(500).send({ message: "Server error" });
  }
});


// GET /admin/service-demand
app.get("/admin/service-demand", async (req, res) => {
  try {
    const bookings = await bookingsCollection.find().toArray();

    const serviceCount = {};
    bookings.forEach(b => {
      const service = b.serviceName;
      if (serviceCount[service]) {
        serviceCount[service] += 1;
      } else {
        serviceCount[service] = 1;
      }
    });

    
    const chartData = Object.keys(serviceCount).map(service => ({
      serviceName: service,
      count: serviceCount[service]
    }));

    res.send(chartData);
  } catch (err) {
    console.error(err);
    res.status(500).send({ message: "Server error" });
  }
});



// USERS 
 app.get('/users', verifyFBToken, async (req, res) => {
            const searchText = req.query.searchText;
            const query = {};

            if (searchText) {
              

                query.$or = [
                    { displayName: { $regex: searchText, $options: 'i' } },
                    { email: { $regex: searchText, $options: 'i' } },
                ]

            }

            const cursor = usersCollection.find(query).sort({ createdAt: -1 }).limit(5);
            const result = await cursor.toArray();
            res.send(result);
        });
app.get('/users/:email', async (req, res) => {
            const email = req.params.email;
            const query = { email }
            const user = await usersCollection.findOne(query);
            res.send({ role: user?.role || 'user' })
        })

    app.post('/users', async (req, res) => {
            const user = req.body;
            user.role = 'user';
            user.createdAt = new Date();
            const email = user.email;
            const userExists = await usersCollection.findOne({ email })

            if (userExists) {
                return res.send({ message: 'user exists' })
            }

            const result = await usersCollection.insertOne(user);
            res.send(result);
        })


        app.get("/users/:email/role", async (req, res) => {
  const email = req.params.email;
  try {
    const user = await usersCollection.findOne({ email });
    if (!user) {
      return res.status(404).send({ message: "User not found" });
    }
    res.send(user);
  } catch (err) {
    console.error(err);
    res.status(500).send({ message: "Server error" });
  }
});


app.patch("/users/:email", verifyFBToken, async (req, res) => {
  const email = req.params.email;

  
  if (req.decoded_email !== email) {
    return res.status(403).send({ message: "Forbidden access" });
  }

  try {
    const updateData = req.body;
    const result = await usersCollection.updateOne(
      { email },
      { $set: updateData }
    );
    res.send(result);
  } catch (err) {
    console.error("Profile update error:", err);
    res.status(500).send({ message: "Server error" });
  }
});

app.patch('/users/:id/role', verifyFBToken,verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const roleInfo = req.body;
            const query = { _id: new ObjectId(id) }
            const updatedDoc = {
                $set: {
                    role: roleInfo.role
                }
            }
            const result = await usersCollection.updateOne(query, updatedDoc)
            res.send(result);
        })

// decorators api
app.get("/decorators", async(req, res) =>{
  const query = { }
  if(req.query.status){
    query.status =req.query.status
  }
  const cursor = decoratorsCollection.find(query)
  const result = await cursor.toArray();
  res.send(result);
})
app.post("/decorators", async(req, res) => {
  const decorator = req.body;
  decorator.status = "pending";
  decorator.createdAt = new Date();
  const result = await decoratorsCollection.insertOne(decorator);
  res.send(result)
})

app.patch('/decorators/:id', verifyFBToken, verifyAdmin,async (req, res) => {
  const status = req.body.status;
  const id = req.params.id;
  const query = { _id: new ObjectId(id) };
  
  const decorator = await decoratorsCollection.findOne(query); 
  if (!decorator) return res.status(404).send({ message: "Decorator not found" });

  const updatedDoc = {
    $set: {
      status: status,
      workStatus: 'available'
    }
  }

  const result = await decoratorsCollection.updateOne(query, updatedDoc);

  if (status === 'approved') {
    const userQuery = { email: decorator.email }; 
    const updateUser = { $set: { role: 'decorator' } };
    await usersCollection.updateOne(userQuery, updateUser);
  }

  res.send(result);
})

app.delete('/decorators/:id', verifyFBToken, async (req, res) => {
  const id = req.params.id;

  const result = await decoratorsCollection.deleteOne({
    _id: new ObjectId(id)
  });

  res.send(result);
});

 // My Assigned Projects
app.get("/decorator/my-bookings", verifyFBToken, async (req, res) => {
  const email = req.decoded_email;

  const bookings = await bookingsCollection.find({
    "decoratorAssigned.decoratorEmail": email
  }).toArray();

  res.send(bookings); 
});


  //  Today's Schedule 
app.get("/decorator/today-schedule", verifyFBToken, async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0); 

    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1); 

    const bookings = await bookingsCollection.find({
      "decoratorAssigned.decoratorEmail": req.decoded_email,
      eventDate: { $gte: today, $lt: tomorrow } 
    }).toArray();

    res.send(bookings);

  } catch (err) {
    console.error(err);
    res.status(500).send({ message: "Server error" });
  }
});



  
  // Update Project Status
app.patch("/decorator/update-status/:id", verifyFBToken, async (req, res) => {
  const booking = await bookingsCollection.findOne({
    _id: new ObjectId(req.params.id),
    "decoratorAssigned.decoratorEmail": req.decoded_email,
  });

  if (!booking) return res.status(403).send({ message: "forbidden" });

  const result = await bookingsCollection.updateOne(
    { _id: new ObjectId(req.params.id) },
    { $set: { status: req.body.status } }
  );

  res.send(result);
});

app.get("/decorator/earnings", verifyFBToken, async (req, res) => {
  const decoratorEmail = req.decoded_email;
  let payments = await paymentsCollection.find({}).toArray();

  // ensure all payments have decoratorEmail
  payments = await Promise.all(
    payments.map(async p => {
      if (!p.decoratorEmail) {
        const booking = await bookingsCollection.findOne({ _id: new ObjectId(p.bookingId) });
        if (booking?.decoratorAssigned?.decoratorEmail) {
          await paymentsCollection.updateOne(
            { _id: p._id },
            { $set: { decoratorEmail: booking.decoratorAssigned.decoratorEmail } }
          );
          p.decoratorEmail = booking.decoratorAssigned.decoratorEmail;
        }
      }
      return p;
    })
  );

  // filter for current decorator
  const decoratorPayments = payments.filter(p => p.decoratorEmail === decoratorEmail);
  const total = decoratorPayments.reduce((sum, p) => sum + Number(p.amount || 0), 0);

  res.send({ total, count: decoratorPayments.length, payments: decoratorPayments });
});



// STRIPE PAYMENT
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


// PAYMENT SUCCESS
app.patch("/payment-success/:bookingId", async (req, res) => {
  const { bookingId } = req.params;

  try {
    
    const booking = await bookingsCollection.findOne({ _id: new ObjectId(bookingId) });
    if (!booking) return res.status(404).send({ message: "Booking not found" });

    
    if (booking.paymentStatus !== "paid") {
      await bookingsCollection.updateOne(
        { _id: new ObjectId(bookingId) },
        { $set: { paymentStatus: "paid", paidAt: new Date() } }
      );
    }

    
    const existingPayment = await paymentsCollection.findOne({ bookingId });
    if (!existingPayment) {
      await paymentsCollection.insertOne({
        bookingId,
        userEmail: booking.userEmail,
        decoratorEmail: booking.decoratorAssigned?.decoratorEmail || "unknown",
        serviceName: booking.serviceName,
        amount: booking.price,
        paidAt: new Date(),
      });
    }

    res.send({ message: "Payment updated & saved successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).send({ message: "Server error" });
  }
});



// PAYMENT HISTORY 
 app.get("/payments", verifyFBToken, async (req, res) => {
  try {
    const email = req.query.email;
    if (!email) return res.status(400).send({ message: "Email is required" });

    if (email !== req.decoded_email) {
      return res.status(403).send({ message: 'forbidden access' });
    }

  
    const payments = await paymentsCollection
      .find({ userEmail: email })
      .sort({ paidAt: -1 })
      .toArray();

    
    const uniquePaymentsMap = {};
    payments.forEach(p => {
      if (!uniquePaymentsMap[p.bookingId]) {
        uniquePaymentsMap[p.bookingId] = p;
      }
    });

    const uniquePayments = Object.values(uniquePaymentsMap);

    res.send(uniquePayments);
  } catch (err) {
    console.error(err);
    res.status(500).send({ message: "Server error" });
  }
});



    console.log("MongoDB connected successfully!");
  } finally {
    
  }
}

run().catch(console.dir);

app.get('/', (req, res) => {
    res.send('smart home server is running!')
})

app.listen(port, () => {
    console.log(`smart home app listening on port ${port}`)
})