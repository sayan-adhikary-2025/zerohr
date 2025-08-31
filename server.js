const express = require("express");
const multer = require("multer");
const path = require("path");
const cors = require("cors");
require("dotenv").config(); // load .env file
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 3000;

// Serve static uploads
app.use("/uploads", express.static("uploads"));

// Middleware
app.use(cors());
app.use(express.json());

// ==================== FILE UPLOAD CONFIG ====================
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/");
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  },
});
const upload = multer({ storage });

// ==================== DATABASE CONNECTION (Postgres only) ====================

const db = new Pool({
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "postgres",
  password: process.env.DB_PASS || "yourpassword",
  database: process.env.DB_NAME || "leaveapp",
  port: process.env.DB_PORT || 5432,
   ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: false } : false, // use SSL in prod if needed
});

db.connect()
  .then(() => console.log("✅ Connected to Postgres"))
  .catch((err) => console.error("❌ Postgres connection error:", err.stack));

// ==================== APP START ====================
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

module.exports = db;

// LOGIN API
app.post("/api/login", async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res
      .status(400)
      .json({ status: 0, error: "Username and password are required" });
  }

  try {
    const loginQuery = `
      SELECT id, username, fullname, org_id, user_type
      FROM users
      WHERE username = $1 AND password = $2
    `;

    const result = await db.query(loginQuery, [username, password]);

    if (result.rows.length === 0) {
      return res
        .status(401)
        .json({ status: 0, message: "Invalid username or password" });
    }

    const user = result.rows[0];

    return res.json({
      status: 1,
      user: {
        id: user.id,
        username: user.username,
        fullname: user.fullname,
        org_id: user.org_id,
        user_type: user.user_type,
      },
    });
  } catch (err) {
    console.error("❌ Database error during login:", err.message);
    return res.status(500).json({ status: 0, error: "Internal server error" });
  }
});

// POST: Create a new job posting
app.post("/api/job-postings", async (req, res) => {
  const {
    username,
    title,
    location,
    department,
    work_type,
    job_mode,
    salary_min,
    salary_max,
    job_summary,
    team_info,
    reporting_to,
    responsibilities,
    skills,
    education,
    about_us,
  } = req.body;

  if (!username) {
    return res.status(400).json({ status: 0, error: "Username is required" });
  }

  try {
    // 1. Get org_id for the user
    const getOrgQuery = `SELECT org_id FROM users WHERE username = $1`;
    const orgResult = await db.query(getOrgQuery, [username]);

    if (orgResult.rows.length === 0) {
      return res.status(404).json({ status: 0, error: "User not found" });
    }

    const org_id = orgResult.rows[0].org_id;

    // 2. Insert new job posting
    const insertQuery = `
      INSERT INTO job_postings (
        org_id, title, location, department, work_type, job_mode,
        salary_min, salary_max, job_summary, about_team, reporting_to,
        responsibilities, skills, education_experience, about_us
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      RETURNING id
    `;

    const values = [
      org_id,
      title,
      location,
      department,
      work_type,
      job_mode,
      salary_min,
      salary_max,
      job_summary,
      team_info,
      reporting_to,
      responsibilities,
      skills,
      education,
      about_us,
    ];

    const result = await db.query(insertQuery, values);

    return res.status(201).json({
      status: 1,
      job_id: result.rows[0].id,
      message: "Job created successfully",
    });
  } catch (err) {
    console.error("❌ Insert error:", err.message);
    return res.status(500).json({ status: 0, error: "Insert failed" });
  }
});

// GET: Job listings for user’s org
app.get("/api/job-postings/user/:username", async (req, res) => {
  const { username } = req.params;

  try {
    // 1. Get org_id for this user
    const orgResult = await db.query(
      "SELECT org_id FROM users WHERE username = $1",
      [username]
    );

    if (orgResult.rows.length === 0) {
      return res.status(404).json({ status: 0, error: "User not found" });
    }

    const orgId = orgResult.rows[0].org_id;

    // 2. Get jobs for that org
    const jobResult = await db.query(
      "SELECT * FROM job_postings WHERE org_id = $1 ORDER BY created_at DESC",
      [orgId]
    );

    res.json(jobResult.rows);
  } catch (err) {
    console.error("❌ Error fetching jobs:", err.message);
    res.status(500).json({ status: 0, error: "Database error" });
  }
});

// GET: Fetch single job by ID (for job-view.html)
app.get("/api/job-postings/:id", async (req, res) => {
  const jobId = parseInt(req.params.id, 10);
  console.log("Requested jobId:", jobId);

  try {
    const result = await db.query("SELECT * FROM job_postings WHERE id = $1", [
      jobId,
    ]);
    console.log("Query result:", result);

    if (!result) {
      return res.status(404).json({ error: "Job not found" });
    }

    res.json(result);
  } catch (err) {
    console.error("Error fetching job:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Submit job application
app.post("/api/apply", upload.single("resume"), async (req, res) => {
  const {
    job_id,
    full_name,
    email,
    phone,
    current_location,
    current_company,
    linkedin,
    portfolio,
    cover_letter,
    additional_info,
  } = req.body;

  const resume_link = req.file ? `/uploads/${req.file.filename}` : null;

  if (!job_id || !full_name || !email || !phone || !resume_link) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    // Step 1: Get org_id from job_postings
    const jobResult = await db.query(
      "SELECT org_id FROM job_postings WHERE id = $1",
      [job_id]
    );

    if (jobResult.rows.length === 0) {
      return res.status(404).json({ error: "Job not found" });
    }

    const org_id = jobResult.rows[0].org_id;

    // Step 2: Insert into job_applications
    const insertQuery = `
      INSERT INTO job_applications (
        job_id, org_id, full_name, email, phone, current_location,
        current_company, linkedin, portfolio, cover_letter,
        additional_info, resume_link
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING id
    `;

    const values = [
      job_id,
      org_id,
      full_name,
      email,
      phone,
      current_location,
      current_company,
      linkedin,
      portfolio,
      cover_letter,
      additional_info,
      resume_link,
    ];

    await db.query(insertQuery, values);

    // Step 3: Increment applications count
    await db.query(
      "UPDATE job_postings SET applications = applications + 1 WHERE id = $1",
      [job_id]
    );

    return res
      .status(201)
      .json({ message: "Application submitted successfully" });
  } catch (err) {
    console.error("❌ Application insert error:", err.message);
    return res.status(500).json({ error: "Failed to submit application" });
  }
});

// Get All Applications for Org
app.get("/api/applications/org/:org_id", async (req, res) => {
  const { org_id } = req.params;

  const query = `
    SELECT a.*, j.title, j.department
    FROM job_applications a
    JOIN job_postings j ON a.job_id = j.id
    WHERE a.org_id = $1
    ORDER BY a.created_at DESC
  `;

  try {
    const result = await db.query(query, [org_id]);
    res.json(result.rows);
  } catch (err) {
    console.error("❌ Error loading applications:", err.message);
    res.status(500).json({ error: "Error loading applications" });
  }
});

// Get Single Application by ID
app.get("/api/applications/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const result = await db.query(
      "SELECT * FROM job_applications WHERE id = $1",
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Not found" });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error("❌ Error fetching application:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Update Application Status
app.put("/api/applications/:id/status", async (req, res) => {
  const id = req.params.id;
  const { status } = req.body;

  try {
    const result = await db.query(
      "UPDATE job_applications SET status = $1 WHERE id = $2",
      [status, id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Application not found" });
    }

    res.json({ success: true });
  } catch (err) {
    console.error("❌ Update failed:", err.message);
    res.status(500).json({ error: "Update failed" });
  }
});

// Apply Leave / WFH
app.post("/api/employee/apply", async (req, res) => {
  const {
    username,
    from_date,
    to_date,
    reason,
    leave_type,
    duration,
    leave_wfh,
  } = req.body;

  if (!username || !from_date || !to_date || !reason || !leave_wfh) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const isLeave = leave_wfh === "Leave";
  const validLeaveTypes = ["Sick Leave", "Casual Leave", "Earned Leave"];
  const validDurations = ["Full Day", "Half Day"];

  if (isLeave) {
    if (!leave_type || !validLeaveTypes.includes(leave_type)) {
      return res.status(400).json({ error: "Invalid or missing leave type" });
    }
    if (!duration || !validDurations.includes(duration)) {
      return res.status(400).json({ error: "Invalid or missing duration" });
    }
  }

  try {
    // Step 1: Get user_id
    const userResult = await db.query(
      "SELECT id FROM users WHERE username = $1",
      [username]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    const user_id = userResult.rows[0].id;

    // Step 2: Insert leave request
    const insertQuery = `
      INSERT INTO leave_requests (
        user_id, username, leave_wfh, from_date, to_date, duration, type, reason, status, created_on
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'Pending', CURRENT_TIMESTAMP)
    `;

    const finalLeaveType = isLeave ? leave_type : "";
    const finalDuration = isLeave ? duration : "";

    await db.query(insertQuery, [
      user_id,
      username,
      leave_wfh,
      from_date,
      to_date,
      finalDuration,
      finalLeaveType,
      reason,
    ]);

    res
      .status(201)
      .json({ message: `${leave_wfh} request submitted successfully` });
  } catch (err) {
    console.error("❌ Leave request failed:", err.message);
    res.status(500).json({ error: "Failed to submit request" });
  }
});

// Fetch Leave and WFH
app.get("/api/employee/leave-wfh", async (req, res) => {
  const { user_id } = req.query;

  if (!user_id) {
    return res.status(400).json({ error: "Missing user_id" });
  }

  try {
    // Step 1: Fetch leave balances
    const balanceResult = await db.query(
      `
      SELECT fy_casual_leaves, fy_sick_leaves, fy_earned_leaves,
             pending_casual_leaves, pending_sick_leaves, pending_earned_leaves
      FROM leave_master
      WHERE user_id = $1
    `,
      [user_id]
    );

    if (balanceResult.rows.length === 0) {
      return res.status(404).json({ error: "Leave balance not found" });
    }

    const balances = balanceResult.rows[0];

    const {
      fy_casual_leaves,
      fy_sick_leaves,
      fy_earned_leaves,
      pending_casual_leaves,
      pending_sick_leaves,
      pending_earned_leaves,
    } = balances;

    // Step 2: Fetch leave & WFH history
    const leaveResult = await db.query(
      `
      SELECT id, leave_wfh, from_date, to_date, duration, type, reason, status, created_on
      FROM leave_requests
      WHERE user_id = $1
      ORDER BY created_on DESC
    `,
      [user_id]
    );

    const history = leaveResult.rows;

    res.json({
      remaining_cl: pending_casual_leaves,
      remaining_sl: pending_sick_leaves,
      remaining_el: pending_earned_leaves,
      fy_cl: fy_casual_leaves,
      fy_sl: fy_sick_leaves,
      fy_el: fy_earned_leaves,
      history,
    });
  } catch (err) {
    console.error("❌ Error fetching leave/wfh:", err.message);
    res.status(500).json({ error: "Error fetching leave/WFH data" });
  }
});

// Accept or Reject a leave/wfh
app.post("/api/employee/leave-action", async (req, res) => {
  const { leave_id, action } = req.body;

  if (!leave_id || !["Accepted", "Rejected"].includes(action)) {
    return res.status(400).json({ error: "Invalid input" });
  }

  try {
    // Step 1: Get leave details
    const leaveResult = await db.query(
      `SELECT id, user_id, type, status, leave_wfh 
       FROM leave_requests 
       WHERE id = $1`,
      [leave_id]
    );

    if (leaveResult.rows.length === 0) {
      return res.status(404).json({ error: "Leave not found" });
    }

    const leave = leaveResult.rows[0];

    if (leave.status !== "Pending") {
      return res.status(400).json({ error: "Leave already processed" });
    }

    const { user_id, type, leave_wfh } = leave;

    // Step 2: If rejected
    if (action === "Rejected") {
      await db.query(
        `UPDATE leave_requests SET status = 'Rejected' WHERE id = $1`,
        [leave_id]
      );
      return res.status(200).json({ message: "Rejected successfully" });
    }

    // Step 3: If WFH, accept directly
    if (leave_wfh === "WFH") {
      await db.query(
        `UPDATE leave_requests SET leave_requests.status = 'Accepted' WHERE id = $1`,
        [leave_id]
      );
      return res.status(200).json({ message: "WFH accepted successfully" });
    }

    // Step 4: For Leave, determine leave column
    let leaveColumn = "";
    if (type === "Sick Leave") leaveColumn = "pending_sick_leaves";
    else if (type === "Casual Leave") leaveColumn = "pending_casual_leaves";
    else if (type === "Earned Leave") leaveColumn = "pending_earned_leaves";
    else return res.status(400).json({ error: "Invalid leave type" });

    // Step 5: Get pending leave count
    const pendingResult = await db.query(
      `SELECT ${leaveColumn} FROM leave_master WHERE user_id = $1`,
      [user_id]
    );

    if (pendingResult.rows.length === 0) {
      return res.status(404).json({ error: "Leave master not found" });
    }

    const pendingLeaves = pendingResult.rows[0][leaveColumn];

    if (pendingLeaves <= 0) {
      return res.status(400).json({ error: `No Pending ${type}` });
    }

    // Step 6: Get duration of leave
    const durationResult = await db.query(
      `SELECT duration FROM leave_requests WHERE id = $1`,
      [leave_id]
    );

    const duration = durationResult.rows[0]?.duration;
    if (!duration) {
      return res.status(400).json({ error: "Leave duration not found" });
    }

    const decrement = duration === "Half Day" ? 0.5 : 1;

    // Step 7: Update leave status and decrement leave balance in a transaction
    await db.query("BEGIN");

    await db.query(
      `UPDATE leave_requests SET leave_requests.status = 'Accepted' WHERE id = $1`,
      [leave_id]
    );

    await db.query(
      `UPDATE leave_master SET ${leaveColumn} = ${leaveColumn} - $1 WHERE user_id = $2`,
      [decrement, user_id]
    );

    await db.query("COMMIT");

    return res
      .status(200)
      .json({ message: "Leave accepted and balance updated" });
  } catch (err) {
    await db.query("ROLLBACK").catch(() => {});
    console.error("❌ Leave action error:", err.message);
    return res.status(500).json({ error: "Failed to process leave action" });
  }
});

// Fetch Employees under a Manager
app.post("/api/manager/employees", async (req, res) => {
  const { username } = req.body;

  if (!username) {
    return res.status(400).json({ error: "Username is required" });
  }

  try {
    // Step 1: Get manager ID
    const managerResult = await db.query(
      `SELECT id FROM users WHERE username = $1`,
      [username]
    );

    if (managerResult.rows.length === 0) {
      return res.status(404).json({ error: "Manager not found" });
    }

    const managerId = managerResult.rows[0].id;

    // Step 2: Get all employee_ids under this manager
    const employeeIdsResult = await db.query(
      `SELECT employee_id FROM employee_manager WHERE manager_id = $1`,
      [managerId]
    );

    if (employeeIdsResult.rows.length === 0) {
      return res.status(200).json({ employees: [] }); // No direct reports
    }

    const employeeIds = employeeIdsResult.rows.map((r) => r.employee_id);

    // Step 3: Get employee data from employee table
    // Generate placeholders dynamically for IN clause
    const placeholders = employeeIds.map((_, i) => `$${i + 1}`).join(",");
    const getEmployeesQuery = `SELECT * FROM employee WHERE user_id IN (${placeholders})`;

    const employeesResult = await db.query(getEmployeesQuery, employeeIds);

    res.status(200).json({ employees: employeesResult.rows });
  } catch (err) {
    console.error("❌ Fetch employees error:", err.message);
    res.status(500).json({ error: "Error retrieving employee details" });
  }
});

// Fetch Employee Data Using username
app.post("/api/employee/details", async (req, res) => {
  const { username } = req.body;

  if (!username) {
    return res
      .status(400)
      .json({ error: "username is required in request body" });
  }

  try {
    // Step 1: Check if user exists
    const userResult = await db.query(
      "SELECT * FROM users WHERE username = $1",
      [username]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    const userId = userResult.rows[0].id;

    // Step 2: Get employee details for that user_id
    const empResult = await db.query(
      "SELECT * FROM employee WHERE user_id = $1",
      [userId]
    );

    if (empResult.rows.length === 0) {
      return res.status(404).json({ error: "Employee details not found" });
    }

    return res.json(empResult.rows[0]);
  } catch (err) {
    console.error("❌ Fetch employee details error:", err.message);
    return res
      .status(500)
      .json({ error: "Database error", details: err.message });
  }
});

// Update editable employee profile fields
app.post("/api/employee/update-profile", async (req, res) => {
  const { username, email, address, dob, marital_status, blood_group } =
    req.body;

  if (!username) return res.status(400).json({ error: "Username is required" });

  try {
    // Step 1: Get user_id
    const userResult = await db.query(
      "SELECT id FROM users WHERE username = $1",
      [username]
    );
    if (userResult.rows.length === 0)
      return res.status(404).json({ error: "User not found" });

    const userId = userResult.rows[0].id;

    // Step 2: Update employee profile
    const updateQuery = `
      UPDATE employee
      SET email = $1,
          address = $2,
          dob = $3,
          marital_status = $4,
          blood_group = $5
      WHERE user_id = $6
    `;
    await db.query(updateQuery, [
      email,
      address,
      dob,
      marital_status,
      blood_group,
      userId,
    ]);

    res.json({ success: true });
  } catch (err) {
    console.error("❌ Update profile error:", err.message);
    res
      .status(500)
      .json({ error: "Database update failed", details: err.message });
  }
});

// Home Summary
app.get("/api/employee/home-summary", async (req, res) => {
  const { username } = req.query;
  if (!username) return res.status(400).json({ error: "username is required" });

  try {
    // Step 1: Get user_id
    const userResult = await db.query(
      "SELECT id FROM users WHERE username = $1",
      [username]
    );
    if (userResult.rows.length === 0)
      return res.status(404).json({ error: "User not found" });
    const userId = userResult.rows[0].id;

    // Step 2: Fetch employee details
    const empResult = await db.query(
      "SELECT * FROM employee WHERE user_id = $1",
      [userId]
    );
    if (empResult.rows.length === 0)
      return res.status(404).json({ error: "Employee not found" });
    const empRow = empResult.rows[0];

    const today = new Date().toISOString().split("T")[0];
    const tomorrow = new Date(Date.now() + 86400000).toISOString().split("T")[0];

    // Step 3: Parallel queries
    const [
      leavesTodayRes,
      leavesTomorrowRes,
      birthdayRes,
      jobRes,
      leaveMasterRes
    ] = await Promise.all([
      db.query(
        `SELECT e.fullname, e.department
         FROM employee e
         JOIN leave_requests l ON e.user_id = l.user_id
         WHERE l.from_date <= $1 AND l.to_date >= $2
           AND l.status = 'Accepted' AND l.leave_wfh = 'Leave'`,
        [today, today]
      ),
      db.query(
        `SELECT e.fullname, e.department
         FROM employee e
         JOIN leave_requests l ON e.user_id = l.user_id
         WHERE l.from_date <= $1 AND l.to_date >= $2
           AND l.status = 'Accepted' AND l.leave_wfh = 'Leave'`,
        [tomorrow, tomorrow]
      ),
      db.query(
        `SELECT fullname, department
         FROM employee
         WHERE TO_CHAR(dob, 'MM-DD') = TO_CHAR(CURRENT_DATE, 'MM-DD')`
      ),
      db.query(
        `SELECT title, department
         FROM job_postings
         WHERE status = 'Active'
         ORDER BY created_at DESC
         LIMIT 5`
      ),
      db.query(
        `SELECT pending_casual_leaves, pending_sick_leaves, pending_earned_leaves
         FROM leave_master
         WHERE user_id = $1`,
        [userId]
      ),
    ]);

    res.json({
      fullname: empRow.fullname,
      position: empRow.position,
      reporting_manager: empRow.reporting_manager,
      joining_date: empRow.joining_date,
      email: empRow.email,

      remaining_cl: leaveMasterRes.rows[0]?.pending_casual_leaves || 0,
      remaining_sl: leaveMasterRes.rows[0]?.pending_sick_leaves || 0,
      remaining_el: leaveMasterRes.rows[0]?.pending_earned_leaves || 0,

      leave_today: leavesTodayRes.rows,
      leave_tomorrow: leavesTomorrowRes.rows,
      birthdays: birthdayRes.rows,
      jobs: jobRes.rows,
    });
  } catch (err) {
    console.error("❌ Fetch home summary error:", err.message);
    res.status(500).json({ error: "Server error", details: err.message });
  }
});


// GET: Fetch all employees for a given org_id
app.get("/api/fetch_employees", async (req, res) => {
  const org_id = parseInt(req.query.org_id, 10);

  if (!org_id) {
    return res.status(400).json({ error: "Missing or invalid org_id" });
  }

  try {
    const result = await db.query("SELECT * FROM employee WHERE org_id = $1", [
      org_id,
    ]);

    res.json({ data: result.rows });
  } catch (err) {
    console.error("Error fetching employees:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// PUT: Update employee by user_id
app.put("/api/employees/update", async (req, res) => {
  const {
    user_id,
    org_id,
    fullname,
    gender,
    dob,
    email,
    mobile,
    joining_date,
    emp_code,
    department,
    position,
    address,
    blood_group,
    marital_status,
    reporting_manager,
    cityfrom,
    profile_photo,
    about,
    hobbies,
    linkedin,
  } = req.body;

  if (!user_id) {
    return res.status(400).json({ error: "user_id is required" });
  }

  try {
    const updateQuery = `
      UPDATE employee
      SET
        org_id = $1,
        fullname = $2,
        gender = $3,
        dob = $4,
        email = $5,
        mobile = $6,
        joining_date = $7,
        emp_code = $8,
        department = $9,
        position = $10,
        address = $11,
        blood_group = $12,
        marital_status = $13,
        reporting_manager = $14,
        cityfrom = $15,
        profile_photo = $16,
        about = $17,
        hobbies = $18,
        linkedin = $19
      WHERE user_id = $20
      RETURNING *;
    `;

    const values = [
      org_id,
      fullname,
      gender,
      dob,
      email,
      mobile,
      joining_date,
      emp_code,
      department,
      position,
      address,
      blood_group,
      marital_status,
      reporting_manager,
      cityfrom,
      profile_photo,
      about,
      hobbies,
      linkedin,
      user_id,
    ];

    const result = await db.query(updateQuery, values);

    if (result.rowCount === 0) {
      return res
        .status(404)
        .json({ error: "Employee not found or no changes made" });
    }

    res.json({ success: true, message: "Employee updated successfully" });
  } catch (err) {
    console.error("Error updating employee:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST: Add new employee with user account
app.post("/api/add_employee", async (req, res) => {
  const {
    org_id,
    fullname,
    user_type,
    username,
    password,
    emp_code,
    position,
    department,
  } = req.body;

  try {
    // 1. Insert into users table
    const userInsert = await db.query(
      `INSERT INTO users (
        org_id, fullname, user_type, username, password
      ) VALUES ($1, $2, $3, $4, $5)`,
      [org_id, fullname, user_type, username, password]
    );

    const user_id = userInsert.lastID;

    // 2. Insert into employee table
    const employeeInsert = await db.query(
      `INSERT INTO employee (
        org_id, user_id, fullname, emp_code, position, department
      ) VALUES ($1, $2, $3, $4, $5, $6)`,
      [org_id, user_id, fullname, emp_code, position, department]
    );

    res.json({
      message: "Employee and user created successfully",
      user_id,
      employee_id: employeeInsert.lastID,
    });
  } catch (err) {
    console.error("Error adding employee:", err);
    res.status(500).json({ error: "Failed to add employee" });
  }
});
