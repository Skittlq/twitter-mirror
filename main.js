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

const runScript = async () => {
  console.clear();
  const currentTime = new Date();
  console.log("Script ran at:", currentTime.toLocaleString());
  try {
    // Fetch new tweets; each element in 'tweets' is an array (thread)
    const tweets = await checkForNewTweets();

    // Read existing threads from postedTweets.json
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

    // --- Merge Threads Preserving Grouping ---

    // 1. Update threads that already exist by merging in new tweets (e.g. new replies)
    const updatedPostedTweets = postedTweets.map((postedThread) => {
      // Find a thread in new tweets that overlaps with the current posted thread
      const matchingNewThread = tweets.find((newThread) =>
        newThread.some((newTweet) =>
          postedThread.some((postedTweet) => postedTweet.url === newTweet.url)
        )
      );
      if (matchingNewThread) {
        // Merge: add any tweet from the new thread that's not already in the posted thread
        const mergedThread = [
          ...postedThread,
          ...matchingNewThread.filter(
            (newTweet) =>
              !postedThread.some(
                (postedTweet) => postedTweet.url === newTweet.url
              )
          ),
        ];
        return mergedThread;
      } else {
        return postedThread;
      }
    });

    // 2. Add any completely new threads that don't match any existing thread
    const newThreads = tweets.filter(
      (newThread) =>
        !postedTweets.some((postedThread) =>
          postedThread.some((postedTweet) =>
            newThread.some((newTweet) => newTweet.url === postedTweet.url)
          )
        )
    );

    // Combine the updated threads with the new threads
    const finalTweets = [...newThreads, ...updatedPostedTweets];

    // Check if there is any update (or new tweets) compared to what's stored
    const isDifferent =
      JSON.stringify(finalTweets) !== JSON.stringify(postedTweets);

    if (isDifferent) {
      console.log("New tweets found, updating threads...");
      console.log("Posting new tweets to Bluesky...");
      // Uncomment the following line when you're ready to post:
      // await postToBluesky(finalTweets);
      console.log("New tweets posted to Bluesky.");
      // Write the updated threads back to postedTweets.json
      fs.writeFileSync(
        postedTweetsPath,
        JSON.stringify(finalTweets, null, 2),
        "utf8"
      );
      console.log("Updated postedTweets.json");
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
