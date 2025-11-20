// ===============================
// server.js
// ===============================
const express = require("express");
const mongoose = require("mongoose");
const bodyParser = require("body-parser");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const { v4: uuidv4 } = require("uuid");
require("dotenv").config();
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const cloudinary = require("cloudinary").v2;
const streamifier = require('streamifier');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());

app.use(bodyParser.json({ limit: "200mb" }));
app.use(bodyParser.urlencoded({ limit: "200mb", extended: true }));

app.use(express.static(path.join(__dirname, "public"))); // serve static files

// ----------------- CLOUDINARY CONFIG -----------------
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// ----------------- MONGOOSE CONNECT -----------------
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB Connected"))
  .catch((err) => console.log("❌ MongoDB Connection Error:", err));

// ----------------- MODELS -----------------
const studentSchema = new mongoose.Schema({
  name: { type: String, required: true },
  dob: { type: Date, required: true },
  gender: { type: String, required: true },
  branch: { type: String, required: true },
  year: { type: String, required: true },
  college: { type: String, required: true },
  passingyear: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  phone: { type: String, required: true },
  address: { type: String },
  photo: { type: String }, // Cloudinary URL
  createdAt: { type: Date, default: Date.now },
  testsTaken: { type: Boolean, default: false },
});

const Student = mongoose.model("Student", studentSchema);

const userSchema = new mongoose.Schema({
  name: String,
  email: { type: String, unique: true },
  password: String,
  role: { type: String, enum: ["student", "admin"], default: "student" },
});
const User = mongoose.model("User", userSchema);

const testSchema = new mongoose.Schema({
  title: { type: String, required: true },
  subject: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
  duration: Number,
  resultsDeclared: { type: Boolean, default: false },
  questions: [
    {
      question: { type: String, required: true },
      options: { type: [String], required: true },
      correctAnswer: { type: Number, required: true },
      explanation: { type: String, default: "" },
    },
  ],
});
const Test = mongoose.model("Test", testSchema);

const submissionSchema = new mongoose.Schema({
  userEmail: { type: String, required: true },
  userName: { type: String, required: true },
  testId: { type: mongoose.Schema.Types.ObjectId, ref: "Test", required: true },
  score: Number,
  totalQuestions: Number,
  correctCount: Number,
  wrongCount: Number,
  answers: [
    {
      question: String,
      options: [String],
      selectedOption: Number,
      correctOption: Number,
      correctOptionText: String,
      isCorrect: Boolean,
      explanation: String,
    },
  ],
  submittedAt: { type: Date, default: Date.now },
});
const Submission = mongoose.model("Submission", submissionSchema);


const snapshotSchema = new mongoose.Schema({
  testId: { type: mongoose.Schema.Types.ObjectId, ref: "Test", required: true },
  userEmail: { type: String, required: true },
  snapshot: String, // Cloudinary URL
  timestamp: { type: Date, default: Date.now },
});
const Snapshot = mongoose.model("Snapshot", snapshotSchema);

const videoSchema = new mongoose.Schema({
  testId: { type: mongoose.Schema.Types.ObjectId, ref: "Test", required: true },
  userEmail: { type: String, required: true },
  videoUrl: String, // Cloudinary URL
  chunkIndex: { type: Number },  
  timestamp: { type: Date, default: Date.now },
});

const Video = mongoose.model("Video", videoSchema); 

const visibilityEventSchema = new mongoose.Schema({
  testId: { type: mongoose.Schema.Types.ObjectId, ref: "Test", required: true },
  userEmail: { type: String, required: true },
  event: { type: String, enum: ["hidden", "visible"], required: true },
  timestamp: { type: Date, default: Date.now },
  switchCount: { type: Number, default: 0 },
});
const VisibilityEvent = mongoose.model("VisibilityEvent", visibilityEventSchema);

// ----------------- ROUTES -----------------
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// --------- AUTH ROUTES ----------
app.post("/register", async (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    if (!email || !password || !name)
      return res.status(400).json({ success: false, message: "Missing fields" });

    const existing = await User.findOne({ email });
    if (existing)
      return res.status(400).json({ success: false, message: "User already exists" });

    const salt = await bcrypt.genSalt(10);
    const hashed = await bcrypt.hash(password, salt);
    const user = new User({ name, email, password: hashed, role: role || "student" });
    await user.save();

    res.status(201).json({ success: true, message: "Registration successful" });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error", error: err.message });
  }
});

app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user)
      return res.status(404).json({ success: false, message: "User not found" });

    const match = await bcrypt.compare(password, user.password);
    if (!match)
      return res.status(401).json({ success: false, message: "Invalid password" });

    res.json({
      success: true,
      message: "Login successful",
      username: user.name,
      email: user.email,
      userId: user._id,
      role: user.role,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error", error: err.message });
  }
});

app.get("/admin/users", async (req, res) => {
  try {
    const users = await User.find().select("-password").sort({ name: 1 });
    res.json(users);
  } catch (err) {
    res.status(500).json({ success: false, message: "Error fetching users", error: err.message });
  }
});



// --------- TEST MANAGEMENT ----------
app.post("/admin/add-test", async (req, res) => {
  try {
    const { title, subject, duration, questions } = req.body;
    if (!title || !subject || !Array.isArray(questions))
      return res.status(400).json({ success: false, message: "Invalid payload" });

    const t = new Test({ title, subject, duration, questions });
    await t.save();
    res.status(201).json({ success: true, message: "Test added", testId: t._id });
  } catch (err) {
    res.status(500).json({ success: false, message: "Error adding test", error: err.message });
  }
});

app.get("/admin/tests", async (req, res) => {
  try {
    const tests = await Test.find().sort({ createdAt: -1 });
    res.json(tests);
  } catch (err) {
    res.status(500).json({ success: false, message: "Error fetching tests", error: err.message });
  }
});

app.get("/api/getTest/:id", async (req, res) => {
  try {
    const test = await Test.findById(req.params.id);
    if (!test) return res.status(404).json({ success: false, message: "Test not found" });
    res.json(test);
  } catch (err) {
    res.status(500).json({ success: false, message: "Error fetching test", error: err.message });
  }
});

// --------- SUBMIT TEST ----------
app.post("/api/submitTest", async (req, res) => {
  try {
    const { testId, answers, userEmail, userName } = req.body;
    if (!testId || !answers || !userEmail || !userName)
      return res.status(400).json({ success: false, message: "Missing fields" });

    const test = await Test.findById(testId);
    if (!test) return res.status(404).json({ success: false, message: "Test not found" });

    let correctCount = 0;
    const answerAnalysis = test.questions.map((q, i) => {
      const selected = typeof answers[i] !== "undefined" ? answers[i] : undefined;
      const isCorrect = selected === q.correctAnswer;
      if (isCorrect) correctCount++;
      return {
        question: q.question,
        options: q.options,
        selectedOption: selected,
        correctOption: q.correctAnswer,
        correctOptionText: q.options[q.correctAnswer],
        isCorrect,
        explanation: q.explanation || "",
      };
    });

    const wrongCount = test.questions.length - correctCount;
    const score = (correctCount / test.questions.length) * 100;

    const newSubmission = new Submission({
      userEmail,
      userName,
      testId,
      score,
      totalQuestions: test.questions.length,
      correctCount,
      wrongCount,
      answers: answerAnalysis,
    });
    await newSubmission.save();

    res.json({
      success: true,
      message: "Test submitted successfully!",
      score,
      correctCount,
      wrongCount,
      submissionId: newSubmission._id,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "Error saving test submission", error: err.message });
  }
});

app.get("/admin/submissions", async (req, res) => {
  try {
    const submissions = await Submission.find().populate("testId", "title subject");
    res.json(submissions);
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Error fetching submissions", error: err.message });
  }
});

app.get("/user/submissions/:email", async (req, res) => {
  try {
    const email = req.params.email;
    const subs = await Submission.find({ userEmail: email }).populate("testId", "title subject");
    res.json(subs);
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Error fetching user submissions", error: err.message });
  }
});

// ----------------- EXAM ACTIVITY ROUTES -----------------

// Helper: Upload base64 to Cloudinary
async function uploadBase64ToCloudinary(base64Data, folder) {
  try {
    if (!base64Data.startsWith("data:")) return null;
    const result = await cloudinary.uploader.upload(base64Data, {
      folder,
      resource_type: "auto",
      public_id: uuidv4(),
    });
    return result.secure_url;
  } catch (err) {
    console.error("Cloudinary upload error:", err);
    return null;
  }
}

// 1️⃣ Start Exam
app.post("/api/startExam", async (req, res) => {
  try {
    const { testId, userEmail, userName, identityPhoto, timestamp } = req.body;
    if (!testId || !userEmail || !userName || !identityPhoto)
      return res.status(400).json({ success: false, message: "Missing fields" });

    const photoUrl = await uploadBase64ToCloudinary(identityPhoto, "identity");
    const session = new ExamSession({
      testId,
      userEmail,
      userName,
      identityPhoto: photoUrl,
      timestamp,
    });
    await session.save();
    res.json({ success: true, message: "Exam session started", sessionId: session._id });
  } catch (err) {
    res.status(500).json({ success: false, message: "Error starting exam", error: err.message });
  }
});

const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "exam_proctoring",
    format: async () => "jpg",
    public_id: (req, file) => uuidv4(),
  },
});
const upload = multer({ storage });

// 2️⃣ Upload Snapshot
app.post("/api/uploadSnapshot", async (req, res) => {
  try {
    const { testId, userEmail, snapshot, timestamp } = req.body;
    if (!testId || !userEmail || !snapshot)
      return res.status(400).json({ success: false, message: "Missing fields" });

    // Sanitize email for folder naming
    const safeEmail = userEmail.replace(/[@.]/g, "_");

    // Upload to Cloudinary under snapshots/<userEmail>/
    const folderPath = `snapshots/${safeEmail}`;
    const snapUrl = await uploadBase64ToCloudinary(snapshot, folderPath);

    const snap = new Snapshot({ testId, userEmail, snapshot: snapUrl, timestamp });
    await snap.save();

    res.json({ success: true, message: "Snapshot stored", snapshotId: snap._id });
  } catch (err) {
    console.error("❌ Snapshot upload error:", err);
    res.status(500).json({ success: false, message: "Error saving snapshot", error: err.message });
  }
});


// 3️⃣ Upload Video
const uploadMemory = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } }); // 10 MB limit

app.post('/api/uploadVideoChunk', uploadMemory.single('video'), async (req, res) => {
try {
const file = req.file;
const { testId, userEmail, chunkIndex, timestamp } = req.body;
if (!file || !testId || !userEmail) return res.status(400).json({ success: false, message: 'Missing fields' });


// sanitize folder name
const safeEmail = userEmail.replace(/[@.]/g, "_");
const folderPath = `uploads/${safeEmail}_videos`;


console.log(`📦 Received chunk ${chunkIndex} size=${file.size} bytes for ${userEmail}`);


// upload stream to Cloudinary using upload_stream
const publicId = `video_${Date.now()}_chunk_${chunkIndex}`;


const streamUpload = () => new Promise((resolve, reject) => {
const stream = cloudinary.uploader.upload_stream(
{
folder: folderPath,
resource_type: 'video',
public_id: publicId
},
(error, result) => {
if (error) return reject(error);
resolve(result);
}
);
streamifier.createReadStream(file.buffer).pipe(stream);
});


const result = await streamUpload();
const videoRecord = new Video({ testId, userEmail, videoUrl: result.secure_url, chunkIndex: Number(chunkIndex), timestamp: timestamp || Date.now() });
await videoRecord.save();


return res.json({ success: true, url: result.secure_url, chunkIndex });
} catch (err) {
console.error('❌ Chunk upload failed:', err);
return res.status(500).json({ success: false, message: 'Chunk upload failed', error: err.message });
}
});

app.post("/api/uploadVideo", async (req, res) => {
  try {
    const { testId, userEmail, video, timestamp } = req.body;
    if (!video || !testId || !userEmail) {
      return res.status(400).json({ error: 'Missing fields' });
    }

    console.log('📦 Received video chunk');

    // Sanitize email for safe folder naming
    const safeEmail = userEmail.replace(/[@.]/g, "_");

    // Upload to uploads/<userEmail>_videos/
    const folderPath = `uploads/${safeEmail}_videos`;

    const uploadResponse = await cloudinary.uploader.upload_large(video, {
      folder: folderPath,
      resource_type: 'video',
      chunk_size: 6_000_000,
      public_id: `video_${Date.now()}`, // optional naming format
    });

    // Save video metadata in DB
    const videoRecord = new Video({
      testId,
      userEmail,
      videoUrl: uploadResponse.secure_url,
      timestamp
    });
    await videoRecord.save();

    res.status(200).json({ success: true, url: uploadResponse.secure_url });
    console.log('✅ Upload successful:', uploadResponse.secure_url);
  } catch (error) {
    console.error('❌ Upload failed:', error);
    res.status(500).json({
      error: 'Video upload failed',
      details: error.message,
    });
  }
});

app.post("/api/studentDetails", async (req, res) => {
  try {
    const { name, dob, gender, branch, year, college, passingyear, email, phone, address, photo } = req.body;
    if (!name || !dob || !gender || !branch || !year || !college || !passingyear || !email || !phone || !photo)
      return res.status(400).json({ success: false, message: "Missing fields" });
const safeEmail = email.replace(/[@.]/g, "_");
const photopath = `studentIdentities/${safeEmail}/photo`;
    const photoUrl = await uploadBase64ToCloudinary(photo, photopath);
    const student = new Student({
      name,
      dob,
      gender,
      branch,
      year,
      college,
      passingyear,
      email,
      phone,
      address,
      photo: photoUrl,
      testsTaken: false,
    });

    await student.save();
    res.json({ success: true, message: "Student details saved!", student });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: "Error saving student details" });
  }
});

app.get("/api/studentDetails/:email", async (req, res) => {
  try {
    const email = req.params.email;
    const student = await Student.findOne({ email });
    if (!student) return res.status(404).json({ success: false, message: "Student not found" });
    res.json({ success: true, student });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: "Error fetching student details" });
  }
});
app.put("/api/updateTestsTaken/:email", async (req, res) => {
  try {
    const email = req.params.email;
    const { testsTaken } = req.body;
    const student = await Student.findOneAndUpdate(
      { email },
      { testsTaken },
      { new: true }
    );
    res.json({ success: true, student });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: "Error updating tests taken" });
  }
});

// PUT: Declare Results for an Exam
app.put("/admin/tests/:id/declareResults", async (req, res) => {
  try {
    const { id } = req.params;
    const { resultsDeclared } = req.body;

    const test = await Test.findByIdAndUpdate(
      id,
      { resultsDeclared },
      { new: true }
    );

    if (!test) return res.status(404).json({ success: false, message: "Test not found" });

    res.json({ success: true, message: "Results declared successfully", test });
  } catch (err) {
    console.error("❌ Error declaring results:", err);
    res.status(500).json({ success: false, message: "Error declaring results" });
  }
});
// 🔍 Admin - Get full monitoring data for a specific user in a test
app.get("/admin/exam-media/:testId/:email", async (req, res) => {
  try {
    const { testId, email } = req.params;
    const decodedEmail = decodeURIComponent(email);
    // Fetch all snapshots for that user & test
    const snapshots = await Snapshot.find({ testId, userEmail: decodedEmail })
      .sort({ timestamp: 1 });

    // Fetch all videos for that user & test
    const videos = await Video.find({ testId, userEmail: decodedEmail })
      .sort({ timestamp: 1 });
    res.json({
      success: true,
      snapshots,
      videos: videos.map(v => v.videoUrl), // return only URLs to frontend
    });
  } catch (err) {
    console.error("❌ Error fetching exam media:", err);
    res.status(500).json({ success: false, message: "Error fetching media", error: err.message });
  }
});
// ----------------- START SERVER -----------------
app.listen(PORT, () => {
    console.log(`🚀 Server running on https://online-assessment-o50m.onrender.com/`);
});
