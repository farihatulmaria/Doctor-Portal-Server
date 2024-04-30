const express = require('express');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const cors = require('cors');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const stripe = require('stripe')(`${process.env.STRIPE_SECRET_KEY}`);


const app = express();
const port = process.env.PORT || 5000;

// middleware
app.use(cors());
app.use(express.json()); 



const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.n5c9c.mongodb.net/myFirstDatabase?retryWrites=true&w=majority`;
const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });

function verifyJWT(req,res,next){
  const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).send({ message: 'UnAuthorized access 🤫' });
    }
    const token = authHeader.split(' ')[1];
    jwt.verify(token, process.env.ACCESS_TOKEN_SECRET,(err, decoded) =>{
      if (err) {
        return res.status(403).send({ message: 'Forbidden access 😅' })
      }
      req.decoded = decoded;
      next();
  });
}

async function run(){
    try{
        await client.connect();
        const servicesCollection = client.db("doctor-portal").collection("services");
        const bookingCollection = client.db("doctor-portal").collection("booking");
        const usersCollection = client.db("doctor-portal").collection("users");
        const doctorsCollection = client.db("doctor-portal").collection("doctors");
        const paymentsCollection = client.db("doctor-portal").collection("payments");
        

        const verifyAdmin = async (req,res,next)=>{
          const requester = req.decoded.email;
          const requesterAccount = await usersCollection.findOne({ email: requester });
          if (requesterAccount.role === 'admin') {
            next();
          }
          else {
            res.status(403).send({ message: 'forbidden' });
          }
        }

        app.post('/create-payment-intent',verifyJWT, async (req,res)=>{
          // const {price} = req.body;
          const service = req.body;
          const price = service.price;
          const amount = price * 100;
          const paymentIntent = await stripe.paymentIntents.create({
            amount:amount,
            currency:'usd',
            payment_method_types:['card']
          })
          res.send({clientSecret: paymentIntent.client_secret})
        })


        // services
        app.get('/services', async (req,res)=>{
          const query = {};
          const cursor = servicesCollection.find(query).project({name:1,});
          const services = await cursor.toArray();
          res.send(services);
        })


         /* 
            API naming convention

            - app.get('/booking') - get all booking in this way

            - app.get('/booking/:id') - getting a specific booking 

            - app.post('/booking') - adding a new booking

            - app.put('/booking/:id') - updating a specific booking if it exists if it doesn't then insert the booking


            - app.delete('/booking/:id') - deleting a booking
         */
        
        
        // users
        app.get('/users', verifyJWT,async(req,res)=>{
          const query = {};
          const users = await usersCollection.find(query).toArray();
          res.send(users);
        })
        app.get('/admin/:email',async(req,res)=>{
          const email = req.params.email;
          const user = await usersCollection.findOne({email: email});
          const isAdmin = user.role === 'admin';
          res.send({admin: isAdmin})
        })


        app.put('/users/admin/:email' ,verifyJWT , async(req,res)=>{
          const email = req.params.email;
          const requester = req.decoded.email;
          const requesterAccount = await usersCollection.findOne({ email: requester });
          if (requesterAccount.role === 'admin') {
            const filter = { email: email };
            const updateDoc = {
              $set: { role: 'admin' },
            };
            const result = await usersCollection.updateOne(filter, updateDoc); 
            res.send(result);
          }
          
          else{
            res.status(403).send({message: 'forbidden'});
          }
        })

        app.put('/users/:email',async(req,res)=>{
          const email = req.params.email;
          const user = req.body.user;
          const filter = {email:email}
          const options = { upsert: true };
          const updateDoc = {
            $set: user
          };
          const result = await usersCollection.updateOne(filter, updateDoc, options);
          const token = jwt.sign({ email: email }, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '1h' })
          res.send({result,token})  
        })
            



        // available

        app.get('/available', async(req,res)=>{
          const date = req.query.date || "May 15, 2022";

          // 1. get all of the services
          const services = await servicesCollection.find().toArray();

          // 2. get all of the booking of that day
          const query = { "date": date,};
          const bookings = await bookingCollection.find(query).toArray();

          // 3 for each service
          services.forEach(service=>{
            // 4: find bookings for that service. output: [{}, {}, {}, {}]
            const serviceBookings = bookings.filter(b => b.treatment === service.name);

            // 5: select slots for the service Bookings: ['', '', '', '']
            const booked = serviceBookings.map(s => s.time);
            
            // 6: select those slots that are not in bookedSlots
            const available = service.slots.filter(slot => !booked.includes(slot));

            //step 7: set available to slots to make it easier 
            service.slots = available; 
          });

          res.send(services)
        })

        // booking

        app.get('/booking',verifyJWT,async(req,res)=>{
          const patientEmail = req.query.patientEmail;
          const decodedEmail = req.decoded.email;
          if(patientEmail === decodedEmail){
            const query = {email:patientEmail}
            const cursor= bookingCollection.find(query);
            const bookings = await cursor.toArray();
            return res.send(bookings);
          }
          
      })

        app.get('/booking/:id', verifyJWT, async(req, res) =>{
          const id = req.params.id;
          const query = {_id: ObjectId(id)};
          const booking = await bookingCollection.findOne(query);
          res.send(booking);
        })


        app.post('/booking' ,async(req,res)=>{
            const booking = req.body.booking;
            const query = { 
                treatment: booking.treatment,
                date: booking.date, 
                patient: booking.patient ,
                time: booking.time,
            }
            const exists = await bookingCollection.findOne(query);
            if (exists) {
              return res.send({ success: false, booking: exists })
            }
            const result = await bookingCollection.insertOne(booking);
            res.send({ success: true, result })
        })
        app.patch('/booking/:id', verifyJWT, async(req, res) =>{
          const id = req.params.id;
          const payment = req.body
          const filter ={_id: ObjectId(id)}
          const updateDoc = {
            $set: {
              paid:true,
              transactionId:payment.transactionId,
            }
          };
          const result = await paymentsCollection.insertOne(payment);
          const updatedBooking = await bookingCollection.updateOne(filter,updateDoc);

          res.send(updateDoc);
        })



        // doctors

        app.get('/doctors', async (req,res)=>{
          const doctors = await doctorsCollection.find({}).toArray();
          res.send(doctors);
        })


        app.post('/doctors',verifyJWT, verifyAdmin , async (req,res)=>{
          const doctor = req.body;
          const result = await doctorsCollection.insertOne(doctor);
          res.send(result);
        })

        app.delete('/doctors/:email', async (req, res) => {
          const email = req.params.email;
          const filter = {email: email};
          const result = await doctorsCollection.deleteOne(filter);
          res.send(result);})
        
    }finally{
        
    }
}

run().catch(console.dir);

app.get('/',(req,res)=>{
    res.send('server is running');
})


app.listen(port,()=>{
    console.log('listening to port:',port);
})