// Assuming you have a file model like this:
const fileSchema = new mongoose.Schema({
    fileName: String,
    fileUrl: String,
    uploadedAt: { type: Date, default: Date.now },
  });
  const File = mongoose.model("File", fileSchema);
  
  // Saving file info after getting file link
  bot.on("document", (msg) => {
    const fileId = msg.document.file_id;
    bot.getFileLink(fileId).then((fileLink) => {
      // Save the file data in your database
      const newFile = new File({
        fileName: msg.document.file_name,
        fileUrl: fileLink,
      });
  
      newFile.save()
        .then(() => {
          console.log(`File saved: ${fileLink}`);
        })
        .catch((err) => {
          console.error("Error saving file:", err);
        });
    });
  });
  