import mongoose from "mongoose";

const mobileSchema = new mongoose.Schema({
    name: String,
    brand: String,
    description: String,
    price: Number,
    rating: Number,
    reviews: Number,
    frontCamera: string,
    rearCamera: Array,
    image: String,
    storage: String,
    os: String,
    category: string,
    stock: number,
    status: string,
    processor: String,
    display: String,
    refreshRate: String,
    storageType: String,
    ram: String,
    battery: String,
    source: String,
    productUrl: String,
    updateBy: mongoose.Types.ObjectId,
    updatedAt: Date,
    createdAt: {
        type: Date,
        default: Date.now
    }
});

export default mongoose.model("Product", mobileSchema);