import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import Product from "../models/productModel.js";

puppeteer.use(StealthPlugin());

// ─── Helpers ────────────────────────────────────────────────

const parsePrice = (str) => {
    if (!str) return null;
    const num = str.replace(/[^0-9]/g, "");
    return num ? parseInt(num, 10) : null;
};

const parseRating = (str) => {
    if (!str) return null;
    const match = str.match(/^[\d.]+$/);
    return match ? parseFloat(str) : null;
};

const parseReviews = (str) => {
    if (!str) return null;
    str = str.toLowerCase().replace(/,/g, "").replace(/\s+/g, "");
    if (str.includes("lakh") || str.endsWith("l")) return Math.round(parseFloat(str) * 100000);
    if (str.includes("k")) return Math.round(parseFloat(str) * 1000);
    const match = str.match(/\d+/);
    return match ? parseInt(match[0]) : null;
};

const cleanName = (name) => {
    if (!name) return null;
    return name
        .replace(/currently\s*unavailable/gi, "")
        .replace(/add\s*to\s*compare/gi, "")
        .replace(/out\s*of\s*stock/gi, "")
        .replace(/sponsored/gi, "")
        .trim();
};

const KNOWN_BRANDS = [
    "samsung", "apple", "oneplus", "xiaomi", "redmi", "realme", "oppo", "vivo",
    "motorola", "nokia", "poco", "iqoo", "nothing", "google", "lava", "tecno",
    "infinix", "asus", "sony", "honor", "huawei", "boat"
];

const extractBrand = (name) => {
    if (!name) return "Unknown";
    const lower = name.toLowerCase();
    const found = KNOWN_BRANDS.find(b => lower.startsWith(b) || lower.includes(` ${b} `));
    if (found) return found.charAt(0).toUpperCase() + found.slice(1);
    return name.split(" ")[0] || "Unknown";
};

const parseSpecs = (specText) => {
    const specs = {
        ram: null, storage: null, processor: null,
        battery: null, display: null, refreshRate: null,
        frontCamera: null, rearCamera: [], os: null,
        storageType: null,
    };
    if (!specText) return specs;

    const get = (regex) => { const m = specText.match(regex); return m ? m[0] : null; };

    specs.ram = get(/\d+\s*GB\s*RAM/i);
    specs.storage = get(/\d+\s*(GB|TB)\s*(ROM|Storage|Internal)?/i);
    specs.battery = get(/\d{3,5}\s*mAh/i);
    specs.display = get(/\d+\.?\d*\s*(inch|")/i);
    specs.refreshRate = get(/\d+\s*Hz/i);

    const rear = get(/\d+\s*MP(?:\s*\+\s*\d+\s*MP)*\s*(Rear|Triple|Dual|Quad|Main|Primary)?/i);
    if (rear) specs.rearCamera = [rear];

    const front = get(/\d+\s*MP\s*(Front|Selfie)/i);
    if (front) specs.frontCamera = front;

    const lower = specText.toLowerCase();
    if (lower.includes("android")) specs.os = "Android";
    else if (lower.includes("ios")) specs.os = "iOS";

    for (const kw of ["snapdragon", "dimensity", "helio", "exynos", "apple a", "unisoc", "mediatek"]) {
        if (lower.includes(kw)) {
            const m = specText.match(new RegExp(`(${kw}[\\w\\s+.-]+?)(?=[,|\\n]|$)`, "i"));
            if (m) { specs.processor = m[0].trim(); break; }
        }
    }

    return specs;
};

// ─── Core scrape logic (runs inside browser) ─────────────────

const extractProductsFromPage = () => {
    const items = [];

    // We know [data-id] cards exist — use them as roots
    const cards = Array.from(document.querySelectorAll("[data-id]"));

    cards.forEach((card) => {
        try {
            const allText = card.innerText || "";

            // ── Price: look for ₹ pattern ──
            const priceMatch = allText.match(/₹[\d,]+/);
            if (!priceMatch) return; // skip non-product cards (banners etc.)

            // ── Name: longest text node in first anchor or heading ──
            const anchors = card.querySelectorAll("a");
            let name = null;
            let productUrl = null;

            for (const a of anchors) {
                const text = a.textContent.trim();
                const href = a.getAttribute("href");
                // Product links contain /p/ in Flipkart
                if (href && href.includes("/p/")) {
                    productUrl = href.startsWith("http")
                        ? href : `https://www.flipkart.com${href}`;
                    // Use title attribute or nearby text as name
                    name = a.getAttribute("title") || a.textContent.trim() || null;
                    if (name && name.length > 10) break;
                }
            }

            // Fallback name: first sizeable text block
            if (!name || name.length < 5) {
                const divs = card.querySelectorAll("div, span");
                for (const el of divs) {
                    const t = el.childNodes.length === 1
                        ? el.textContent.trim() : "";
                    if (t.length > 15 && t.length < 120 && !t.includes("₹")) {
                        name = t;
                        break;
                    }
                }
            }

            if (!name) return;

            // ── Rating: standalone decimal like "4.3" ──
            const ratingMatch = allText.match(/\b([1-5]\.\d)\b/);
            const ratingText = ratingMatch ? ratingMatch[1] : null;

            // ── Reviews: patterns like "1,234 Ratings" "12K Reviews" ──
            const reviewMatch = allText.match(/([\d,]+[kKlL]?)\s*(Ratings?|Reviews?)/i);
            const reviewText = reviewMatch ? reviewMatch[1] : null;

            // ── Image ──
            const img = card.querySelector("img");
            const image = img?.src || img?.dataset?.src || null;

            // ── Specs: list items usually contain spec data ──
            const liEls = card.querySelectorAll("li");
            const specText = Array.from(liEls)
                .map(li => li.textContent.trim())
                .filter(t => t.length > 2)
                .join(" | ");

            // ── Description ──
            const description = specText || name;

            items.push({
                name,
                priceText: priceMatch[0],
                ratingText,
                reviewText,
                image,
                specText,
                productUrl,
                description,
            });
        } catch (_) { }
    });

    return items;
};

// ─── Main Scraper ────────────────────────────────────────────

export const scrapeFlipkartMobiles = async ({
    minPrice = 30000,
    maxPrice = 50000,
    maxPages = 3,
} = {}) => {

    const browser = await puppeteer.launch({
        headless: false, // set true after confirming it works
        slowMo: 60,
        args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-blink-features=AutomationControlled",
            "--window-size=1366,768",
        ],
        defaultViewport: { width: 1366, height: 768 },
    });

    const page = await browser.newPage();

    const UAs = [
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
    ];
    await page.setUserAgent(UAs[Math.floor(Math.random() * UAs.length)]);
    await page.setExtraHTTPHeaders({
        "Accept-Language": "en-IN,en;q=0.9",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    });
    await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, "webdriver", { get: () => false });
        window.chrome = { runtime: {} };
    });

    // Build session via homepage
    console.log("🌐 Warming up session on Flipkart homepage...");
    await page.goto("https://www.flipkart.com", { waitUntil: "networkidle2", timeout: 30000 });
    await new Promise(r => setTimeout(r, 2000 + Math.random() * 1000));

    // Dismiss login popup
    try {
        await page.click("button._2KpZ6l._2doB4z");
        console.log("   ✅ Dismissed login popup");
        await new Promise(r => setTimeout(r, 800));
    } catch (_) { }

    const results = [];
    let savedCount = 0;
    let skippedCount = 0;

    for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
        const url =
            `https://www.flipkart.com/search?q=smartphones` +
            `&p%5B%5D=facets.price_range.from%3D${minPrice}` +
            `&p%5B%5D=facets.price_range.to%3D${maxPrice}` +
            `&sort=price_asc&page=${pageNum}`;

        console.log(`\n🔍 Page ${pageNum}/${maxPages} → ${url}`);

        try {
            await page.goto(url, { waitUntil: "networkidle2", timeout: 40000 });

            // Wait for [data-id] cards to appear (we KNOW they load)
            await page.waitForSelector("[data-id]", { timeout: 15000 });

            // Scroll to trigger lazy-loaded images & specs
            await page.evaluate(async () => {
                for (let i = 0; i < 8; i++) {
                    window.scrollBy(0, 500);
                    await new Promise(r => setTimeout(r, 400));
                }
                window.scrollTo(0, 0);
            });
            await new Promise(r => setTimeout(r, 1500));

            // ── STEP: log actual classes inside first [data-id] card ──
            const cardClasses = await page.evaluate(() => {
                const card = document.querySelector("[data-id]");
                if (!card) return "No card found";
                const all = card.querySelectorAll("*");
                const classes = new Set();
                all.forEach(el => el.className && typeof el.className === "string"
                    && el.className.split(" ").forEach(c => c && classes.add(c)));
                return [...classes].slice(0, 40).join(", ");
            });
            console.log(`   🔬 Classes inside first [data-id] card:\n   ${cardClasses}`);

            const products = await page.evaluate(extractProductsFromPage);
            console.log(`   📦 Extracted: ${products.length} products`);

            for (const raw of products) {
                const price = parsePrice(raw.priceText);
                if (!price || price < minPrice || price > maxPrice) {
                    skippedCount++;
                    continue;
                }


                const specs = parseSpecs(raw.specText);
                const cleanedName = cleanName(raw.name);  // 👈 add this

                const productData = {
                    name: cleanedName,                    // 👈 use cleaned name
                    brand: extractBrand(cleanedName),
                    description: raw.description,
                    price,
                    rating: parseRating(raw.ratingText),
                    reviews: parseReviews(raw.reviewText),
                    frontCamera: specs.frontCamera,
                    rearCamera: specs.rearCamera,
                    image: raw.image,
                    storage: specs.storage,
                    os: specs.os || "Android",
                    category: "Smartphone",
                    stock: 100,
                    status: "active",
                    processor: specs.processor,
                    display: specs.display,
                    refreshRate: specs.refreshRate,
                    storageType: specs.storageType,
                    ram: specs.ram,
                    battery: specs.battery,
                    source: "Flipkart",
                    productUrl: raw.productUrl,
                    updatedAt: new Date(),
                };

                try {
                    await Product.findOneAndUpdate(
                        { productUrl: productData.productUrl },
                        productData,
                        { upsert: true, new: true }
                    );
                    savedCount++;
                    console.log(`   ✅ ${productData.name} — ₹${productData.price}`);
                    results.push(productData);
                } catch (dbErr) {
                    console.error(`   ⚠️  DB Error:`, dbErr.message);
                }
            }

            await new Promise(r => setTimeout(r, 3000 + Math.random() * 2000));

        } catch (err) {
            console.error(`❌ Page ${pageNum} error:`, err.message);
            await page.screenshot({ path: `error_page${pageNum}.png` });
        }
    }

    await browser.close();
    console.log(`\n✅ Done! Saved: ${savedCount} | Skipped: ${skippedCount}`);
    return results;
};