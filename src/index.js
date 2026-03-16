
import dotenv from 'dotenv';
import { connectDB } from './database/dbConnection.js'

dotenv.config();

const startServer = async () => {
    await connectDB();
}

startServer();
