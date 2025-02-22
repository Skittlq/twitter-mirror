import fs from "fs";
import path from "path";
import checkForNewTweets from "./fetchTweets.js";
import postToBluesky from "./services/postToBluesky.js";

const __dirname = path.dirname(
  decodeURIComponent(new URL(import.meta.url).pathname).substring(1)
);
const postedTweetsPath = path.join(__dirname, "postedTweets.json");

// Define the interval (in ms)
// Note: Adjust the value as needed. Here, it's set to 1 minute (60,000 ms)
const intervalTime = 1 * 60 * 1000; // 1 minute
// For 10 minutes, you could use: const intervalTime = 10 * 60 * 1000;

const runScript = async () => {
  console.clear();
  const currentTime = new Date();
  console.log("Script ran at:", currentTime.toLocaleString());
  try {
    const tweets = await checkForNewTweets();

    // Read existing tweets from postedTweets.json
    let postedTweets = [];
    if (fs.existsSync(postedTweetsPath)) {
      const data = fs.readFileSync(postedTweetsPath, "utf8");
      postedTweets = JSON.parse(data);
    } else {
      // Create the file if it doesn't exist
      fs.mkdirSync(path.dirname(postedTweetsPath), { recursive: true });
      fs.writeFileSync(
        postedTweetsPath,
        JSON.stringify(postedTweets, null, 2),
        "utf8"
      );
      console.log("postedTweets.json created");
    }

    const newTweets = tweets.filter(
      (tweet) =>
        !postedTweets.some((postedTweet) => postedTweet.url === tweet.url)
    );
    if (newTweets.length > 0) {
      // Add new tweets to the top of the postedTweets array
      postedTweets = [...newTweets, ...postedTweets];
      console.log("New tweets found:", newTweets.length);
      console.log("Posting new tweets to Bluesky...");
      await postToBluesky(newTweets.reverse());
      console.log("New tweets posted to Bluesky.");
      // Write the updated array back to postedTweets.json
      fs.writeFileSync(
        postedTweetsPath,
        JSON.stringify(postedTweets, null, 2),
        "utf8"
      );

      console.log("New tweets added to postedTweets.json");
    } else {
      console.log("No new tweets to add.");
    }
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
