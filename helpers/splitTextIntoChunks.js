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

export default splitTextIntoChunks;
