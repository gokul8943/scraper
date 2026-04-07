import dotenv from "dotenv";
dotenv.config();

import connectDB from  "./database/dbConnection.js"
import { scrapeFlipkartMobiles } from "./scrapers/filpkartScraper.js";

const main = async () => {
    await connectDB();

    await scrapeFlipkartMobiles({
        minPrice: parseInt(process.env.MIN_PRICE) || 30000,
        maxPrice: parseInt(process.env.MAX_PRICE) || 50000,
        maxPages: parseInt(process.env.MAX_PAGES) || 10,
    });

    process.exit(0);
};

main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
});