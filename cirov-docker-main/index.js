const express = require('express');
const mysql = require('mysql2/promise');
const amqp = require('amqplib');
const bodyParser = require('body-parser');
const http = require('http');
const socketIO = require('socket.io');
const config = require('./config');

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

const port = 3000;

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

const pool = mysql.createPool(config.mysqlConfig);

let rabbitMQConnection;
let rabbitMQChannel;

async function connectRabbitMQ() {
  try {
    rabbitMQConnection = await amqp.connect(config.rabbitMQConfig);
    rabbitMQChannel = await rabbitMQConnection.createChannel();
    await rabbitMQChannel.assertQueue('messages', { durable: false });
    console.log('Connected to RabbitMQ');

    io.on('connection', (socket) => {
      console.log('Client connected');

      socket.on('disconnect', () => {
        console.log('Client disconnected');
      });

      socket.on('chatMessage', async (message) => {
        try {
          const queueName = 'messages';

          await rabbitMQChannel.sendToQueue(queueName, Buffer.from(message));

          io.emit('message', { content: message });
        } catch (error) {
          console.error('Error inserting message into RabbitMQ Queue: ' + error.message);
        }
      });
    });

  } catch (error) {
    console.error('Error connecting to RabbitMQ:', error);
  }
}

connectRabbitMQ();

async function initializeDatabase() {
  try {
    const connection = await pool.getConnection();

    await connection.query(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(255) NOT NULL,
        email VARCHAR(255) NOT NULL
      )
    `);

    connection.release();
    console.log('Database initialization complete.');
  } catch (error) {
    console.error('Error initializing database:', error.message);
  }
}

initializeDatabase();

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

app.post('/create-user', async (req, res) => {
  const { username, email } = req.body;

  try {
    const connection = await pool.getConnection();
    const [result] = await connection.query('INSERT INTO users SET ?', { username, email });

    connection.release();
    res.json({ message: 'User created successfully', userId: result.insertId });
  } catch (error) {
    console.error('Error creating user: ' + error.message);
    res.status(500).json({ error: 'Error creating user' });
  }
});

app.post('/insert-message', async (req, res) => {
  const { message } = req.body;

  try {
    const queueName = 'messages';

    await rabbitMQChannel.sendToQueue(queueName, Buffer.from(message));

    res.json({ message: 'Message inserted into RabbitMQ Queue successfully' });
  } catch (error) {
    console.error('Error inserting message into RabbitMQ Queue: ' + error.message);
    res.status(500).json({ error: 'Error inserting message into RabbitMQ Queue' });
  }
});

app.get('/pop', async (req, res) => {
  try {
    const queueName = 'messages';

    const result = await rabbitMQChannel.get(queueName);

    if (!result) {
      return res.json({ message: 'Queue is empty' });
    }

    const poppedMessage = result.content.toString();
    rabbitMQChannel.ack(result);

    res.json({ message: 'Message popped from RabbitMQ Queue', content: poppedMessage });
  } catch (error) {
    console.error('Error popping message from RabbitMQ Queue: ' + error.message);
    res.status(500).json({ error: 'Error popping message from RabbitMQ Queue' });
  }
});

app.get('/show-users', async (req, res) => {
  try {
    const connection = await pool.getConnection();
    const [results] = await connection.query('SELECT * FROM users');
    connection.release();

    res.json(results);
  } catch (error) {
    console.error('Error fetching users: ' + error.message);
    res.status(500).json({ error: 'Error fetching users' });
  }
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
