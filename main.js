import puppeteer from "puppeteer";
import { AtpAgent } from "@atproto/api";
import dotenv from "dotenv";
import fs from "fs"; // <-- Import fs for file operations
import tumblr from "tumblr.js";
import fetch from "node-fetch"; // Ensure you have node-fetch installed (v3+)
import { Readable } from "stream";

dotenv.config();

const X_USERNAME = process.env.X_USERNAME;
const X_PASSWORD = process.env.X_PASSWORD;

const BSKY_HANDLE = process.env.BSKY_HANDLE;
const BSKY_APP_PASSWORD = process.env.BSKY_APP_PASSWORD;

const TUMBLR_CONSUMER_KEY = process.env.TUMBLR_CONSUMER_KEY;
const TUMBLR_CONSUMER_SECRET = process.env.TUMBLR_CONSUMER_SECRET;
const TUMBLR_TOKEN = process.env.TUMBLR_TOKEN;
const TUMBLR_TOKEN_SECRET = process.env.TUMBLR_TOKEN_SECRET;
const TUMBLR_BLOG_IDENTIFIER = process.env.TUMBLR_BLOG_IDENTIFIER;

// File to store posted tweet URLs
const POSTED_TWEETS_FILE = "./postedTweets.json";

// Helper function: load posted tweets from file
const loadPostedTweets = () => {
  if (fs.existsSync(POSTED_TWEETS_FILE)) {
    try {
      const data = fs.readFileSync(POSTED_TWEETS_FILE, "utf8");
      return JSON.parse(data);
    } catch (err) {
      console.error("Error parsing posted tweets file:", err);
      return [];
    }
  }
  return [];
};

// Helper function: save posted tweets back to file
const savePostedTweets = (tweets) => {
  fs.writeFileSync(POSTED_TWEETS_FILE, JSON.stringify(tweets, null, 2));
};

// Helper function: add a tweet URL to the posted tweets list
const addPostedTweet = (tweetURL) => {
  const tweets = loadPostedTweets();
  tweets.push(tweetURL);
  savePostedTweets(tweets);
};

// Function to split text into chunks of 300 characters
const splitTextIntoChunks = (text, maxLength) => {
  const chunks = [];
  while (text.length > maxLength) {
    let chunk = text.substring(0, maxLength);
    let lastSpace = chunk.lastIndexOf(" ");
    if (lastSpace > 0) {
      chunk = text.substring(0, lastSpace);
    }
    chunks.push(chunk);
    text = text.substring(chunk.length).trim();
  }
  chunks.push(text);
  return chunks;
};

const postToBluesky = async (text, images) => {
  const agent = new AtpAgent({ service: "https://bsky.social" });

  try {
    console.log("Logging into Bluesky...");
    await agent.login({ identifier: BSKY_HANDLE, password: BSKY_APP_PASSWORD });

    // Function to clean up links and remove Twitter ellipses
    const cleanText = (inputText) => {
      return inputText.replace(/\bhttps?:\/\/\S+…/g, (match) =>
        match.replace(/…$/, "")
      );
    };

    // Extract hashtags and links with positions
    const extractFacets = (inputText) => {
      let facets = [];
      let cleanText = inputText;

      // Find links
      const linkRegex = /\bhttps?:\/\/[^\s]+/g;
      cleanText = cleanText.replace(linkRegex, (match, offset) => {
        facets.push({
          index: { byteStart: offset, byteEnd: offset + match.length },
          features: [{ $type: "app.bsky.richtext.facet#link", uri: match }],
        });
        return match;
      });

      // Find hashtags
      const hashtagRegex = /#[A-Za-z0-9_]+/g;
      cleanText = cleanText.replace(hashtagRegex, (match, offset) => {
        facets.push({
          index: { byteStart: offset, byteEnd: offset + match.length },
          features: [
            {
              $type: "app.bsky.richtext.facet#tag",
              tag: match.slice(1), // removes the '#' character
            },
          ],
        });
        return match;
      });

      return { cleanText, facets };
    };

    // Process text
    text = cleanText(text);
    let { cleanText: processedText, facets } = extractFacets(text);
    let chunks = splitTextIntoChunks(processedText, 290);

    let rootPostUri = null;
    let rootPostCid = null;
    let previousPostUri = null;
    let previousPostCid = null;

    for (let i = 0; i < chunks.length; i++) {
      let chunk = chunks[i];

      // Only add the thread emoji if there is more than one chunk and this is the first chunk
      if (chunks.length > 1 && i === 0) {
        chunk = chunk + " 🧵";
      }

      let postData = {
        text: chunk,
        createdAt: new Date().toISOString(),
        facets: facets.filter((facet) => facet.index.byteStart < chunk.length), // Apply only relevant facets
      };

      // Attach images only to the first post
      if (images.length > 0 && rootPostUri === null) {
        console.log("Uploading images to Bluesky...");
        const uploadedImages = await Promise.all(
          images.map(async (url) => {
            const res = await fetch(url);
            const imageBuffer = await res.arrayBuffer();
            return await agent.uploadBlob(new Uint8Array(imageBuffer), {
              encoding: "image/png",
            });
          })
        );

        postData.embed = {
          $type: "app.bsky.embed.images",
          images: uploadedImages.map((img) => ({
            image: img.data.blob,
            alt: "Tweet Image",
          })),
        };
      }

      // Thread handling
      if (previousPostUri) {
        postData.reply = {
          root: { uri: rootPostUri, cid: rootPostCid },
          parent: { uri: previousPostUri, cid: previousPostCid },
        };
      }

      console.log("Posting chunk to Bluesky:", chunk);
      const response = await agent.post(postData);

      if (!rootPostUri) {
        rootPostUri = response.uri;
        rootPostCid = response.cid;
      }

      previousPostUri = response.uri;
      previousPostCid = response.cid;

      console.log("✅ Successfully posted a chunk!");
    }
  } catch (error) {
    console.error("❌ Error posting to Bluesky:", error);
  }
};

/**
 * Posts content to Tumblr using the Neue Post Format (NPF).
 *
 * For photo posts, the caption (text) is provided via the `caption` field,
 * and the images are sent as content blocks. For text-only posts, a single text block is used.
 *
 * @param {string} text - The text content to post (used as caption in photo posts).
 * @param {string[]} images - An array of image URLs. If provided, a photo post will be created.
 */
const postToTumblr = async (text, images = []) => {
  const client = tumblr.createClient({
    consumer_key: TUMBLR_CONSUMER_KEY,
    consumer_secret: TUMBLR_CONSUMER_SECRET,
    token: TUMBLR_TOKEN,
    token_secret: TUMBLR_TOKEN_SECRET,
  });

  try {
    // Extract hashtags from text
    const hashtags = text.match(/#\w+/g) || [];
    const tags = hashtags;
    text = text.replace(/#\w+/g, "").trim();

    // Find links in the text and format them
    const linkRegex = /(https?:\/\/\S+)/g;
    let formattedText = text;
    let formatting = [];
    let match;
    while ((match = linkRegex.exec(text)) !== null) {
      formatting.push({
        start: match.index,
        end: match.index + match[0].length,
        type: "link",
        url: match[0].replace(/\bhttps?:\/\/\S+…/g, (match) =>
          match.replace(/…$/, "")
        ),
      });
    }

    if (images.length > 0) {
      console.log("Uploading images to Tumblr...");

      // Construct the media array from the images array
      const mediaArray = images.map((imageUrl) => ({
        type: "image/jpeg",
        url: imageUrl,
      }));

      console.log("✅ Uploaded images, posting to Tumblr...");

      console.log(
        JSON.stringify({
          content: [
            {
              type: "image",
              media: mediaArray,
              formatting: formatting,
            },
            {
              type: "text",
              text: formattedText || "",
              formatting: formatting,
            },
          ],
          state: "published",
          tags: tags,
        })
      );

      await client.createPost(TUMBLR_BLOG_IDENTIFIER, {
        content: [
          {
            type: "image",
            media: mediaArray,
            formatting: formatting,
          },
          {
            type: "text",
            text: formattedText || "",
            formatting: formatting,
          },
        ],
        state: "published",
        tags: tags,
      });

      console.log("✅ Successfully posted photo post to Tumblr!");
    } else {
      console.log("Posting text post to Tumblr...");

      await client.createPost(TUMBLR_BLOG_IDENTIFIER, {
        content: [
          {
            type: "text",
            text: formattedText,
            formatting: formatting,
          },
        ],
        state: "published",
        tags: tags,
      });

      console.log("✅ Successfully posted text post to Tumblr!");
    }
  } catch (error) {
    console.error("❌ Error posting to Tumblr:", error);
  }
};

const checkForNewTweets = async () => {
  const browser = await puppeteer.launch({
    headless: true,
    userDataDir: "./user_data", // Persistent session storage
  });
  const page = await browser.newPage();

  page.setDefaultNavigationTimeout(60000); // 120 seconds

  page.on("console", (msg) => {
    console.log("PAGE LOG:", msg.text());
  });

  page.on("request", (req) => {
    console.log("Request:", req.method(), req.url());
  });

  page.on("response", (response) => {
    console.log("Response:", response.status(), response.url());
  });

  page.on("requestfailed", (request) => {
    console.log("Request failed:", request.url(), request.failure().errorText);
  });

  try {
    // First, navigate to your timeline to check if you're already logged in
    console.log("Checking if session is active...");
    await page.goto(`https://x.com/${X_USERNAME}`, {
      waitUntil: "domcontentloaded",
    });

    await new Promise((r) => setTimeout(r, 10000));

    // Look for a login selector. If found, then you're not logged in.
    const loginInput = await page.$('input[name="text"]');
    if (loginInput) {
      console.log("Session not active, logging in...");

      // Navigate to the login page
      await page.goto("https://x.com/login", { waitUntil: "domcontentloaded" });

      console.log(page.url());
      // Perform the login steps
      await page.waitForSelector('input[name="text"]', { visible: true });
      await page.type('input[name="text"]', X_USERNAME);
      await page.keyboard.press("Enter");

      await new Promise((r) => setTimeout(r, 10000));

      await page.waitForSelector('input[name="password"]', { visible: true });
      await page.type('input[name="password"]', X_PASSWORD);
      await page.keyboard.press("Enter");

      await new Promise((r) => setTimeout(r, 10000));

      // After logging in, go to your timeline
      await page.goto(`https://x.com/${X_USERNAME}`, {
        waitUntil: "domcontentloaded",
      });
    } else {
      console.log("Session active, skipping login...");
    }

    // Proceed with the rest of the tweet checking
    console.log("Waiting for tweets to load...");
    await page.waitForSelector('[data-testid="tweet"]', { visible: true });

    console.log("Extracting latest tweet URL...");
    const tweetURL = await page.evaluate(() => {
      const tweetLinkElement = document.querySelector(
        '[data-testid="tweet"] a[href*="status/"]'
      );
      return tweetLinkElement
        ? `https://x.com${tweetLinkElement.getAttribute("href")}`
        : null;
    });

    if (!tweetURL) {
      console.log("No tweet found.");
      return;
    }

    // Check if this tweet has already been posted
    const postedTweets = loadPostedTweets();
    if (postedTweets.includes(tweetURL)) {
      console.log("Tweet has already been posted. Skipping...");
      return;
    }

    console.log("Opening full tweet page:", tweetURL);
    await page.goto(tweetURL, { waitUntil: "domcontentloaded" });

    console.log("Waiting for full tweet content to load...");
    await page.waitForSelector('[data-testid="tweetText"]', { visible: true });

    const tweetData = await page.evaluate(() => {
      const tweetTextElement = document.querySelector(
        '[data-testid="tweetText"]'
      );
      const tweetText = tweetTextElement
        ? tweetTextElement.innerText.trim()
        : "No tweet text found.";

      const imageElements = document.querySelectorAll(
        '[data-testid="tweetPhoto"] img'
      );
      const imageURLs = Array.from(imageElements).map((img) => img.src);

      return { tweetText, imageURLs };
    });

    console.log("Latest Tweet:", tweetData.tweetText);
    console.log("Tweet URL:", tweetURL);
    if (tweetData.imageURLs.length > 0) {
      console.log("Tweet Images:", tweetData.imageURLs);
    } else {
      console.log("No images found.");
    }

    // Post to Bluesky
    await postToBluesky(tweetData.tweetText, tweetData.imageURLs);
    await postToTumblr(tweetData.tweetText, tweetData.imageURLs);

    // After successful posting, save the tweet URL
    addPostedTweet(tweetURL);
    console.log("Tweet saved as posted.");
  } catch (error) {
    console.error("Error:", error);
  } finally {
    await browser.close();
  }
};

// Define the interval (in ms)
// Note: Adjust the value as needed. Here, it's set to 1 minute (60,000 ms)
const intervalTime = 5 * 60 * 1000; // 1 minute
// For 10 minutes, you could use: const intervalTime = 10 * 60 * 1000;

const runScript = async () => {
  const currentTime = new Date();
  console.log("Script running at:", currentTime.toLocaleString());

  try {
    await checkForNewTweets();
  } catch (error) {
    console.error("Error in runScript:", error);
  }

  // Calculate and log the next scheduled run time
  const nextRunTime = new Date(currentTime.getTime() + intervalTime);
  console.log("Next run scheduled at:", nextRunTime.toLocaleString());
};

// Run immediately when the script starts
runScript();

// Schedule the script to run every intervalTime milliseconds
setInterval(runScript, intervalTime);
