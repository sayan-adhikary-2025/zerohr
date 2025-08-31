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
  ssl: process.env.DB_SSL === "true", // use SSL in prod if needed
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

    return res.status(201).json({ message: "Application submitted successfully" });
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

// NEED TO SHIFT TO POSTGRES
// Update Application Status
app.put("/api/applications/:id/status", (req, res) => {
  const id = req.params.id;
  const { status } = req.body;
  db.run(
    "UPDATE job_applications SET status = ? WHERE id = ?",
    [status, id],
    function (err) {
      if (err) return res.status(500).json({ error: "Update failed" });
      res.json({ success: true });
    }
  );
});

// View Resume File Publicly

app.use("/uploads", express.static("uploads"));

// Apply Leave

app.post("/api/employee/apply", (req, res) => {
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

  // Validate input values
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

  // Step 1: Fetch user_id
  const userQuery = "SELECT id FROM users WHERE username = ?";
  db.get(userQuery, [username], (err, userRow) => {
    if (err || !userRow) {
      console.error("User lookup error:", err?.message);
      return res.status(500).json({ error: "User not found" });
    }

    const user_id = userRow.id;

    // Step 2: Insert into leave_requests
    const insertQuery = `
      INSERT INTO leave_requests (
        user_id, username, leave_wfh, from_date, to_date, duration, type, reason, status, created_on
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Pending', CURRENT_TIMESTAMP)
    `;

    const finalLeaveType = isLeave ? leave_type : "";
    const finalDuration = isLeave ? duration : "";

    db.run(
      insertQuery,
      [
        user_id,
        username,
        leave_wfh,
        from_date,
        to_date,
        finalDuration,
        finalLeaveType,
        reason,
      ],
      function (err) {
        if (err) {
          console.error("Insert error:", err.message);
          return res.status(500).json({ error: "Failed to submit request" });
        }

        return res
          .status(201)
          .json({ message: `${leave_wfh} request submitted successfully` });
      }
    );
  });
});

//Fetch Leave and WFH
app.get("/api/employee/leave-wfh", (req, res) => {
  const { user_id } = req.query;

  if (!user_id) {
    return res.status(400).json({ error: "Missing user_id" });
  }

  // Step 1: Fetch leave balances
  const balanceQuery = `
    SELECT fy_casual_leaves, fy_sick_leaves, fy_earned_leaves, pending_casual_leaves, pending_sick_leaves, pending_earned_leaves
    FROM leave_master
    WHERE user_id = ?
  `;

  db.get(balanceQuery, [user_id], (err, balances) => {
    if (err || !balances) {
      return res.status(500).json({ error: "Error fetching balances" });
    }

    const {
      fy_casual_leaves,
      fy_sick_leaves,
      fy_earned_leaves,
      pending_casual_leaves,
      pending_sick_leaves,
      pending_earned_leaves,
    } = balances;

    // Step 2: Fetch leave & WFH history
    const leaveQuery = `
      SELECT id, leave_wfh, from_date, to_date, duration, type, reason, status, created_on
      FROM leave_requests
      WHERE user_id = ?
    `;

    db.all(leaveQuery, [user_id], (err, leaves = []) => {
      if (err) {
        console.error("Error fetching leave history:", err.message);
        return res.status(500).json({ error: "Error fetching leaves" });
      }

      // Step 4: Sort leaves and wfh
      const history = [...leaves].sort(
        (a, b) => new Date(b.created_on) - new Date(a.created_on)
      );

      res.json({
        remaining_cl: pending_casual_leaves,
        remaining_sl: pending_sick_leaves,
        remaining_el: pending_earned_leaves,
        fy_cl: fy_casual_leaves,
        fy_sl: fy_sick_leaves,
        fy_el: fy_earned_leaves,

        history,
      });
    });
  });
});

// Accept or Reject a leave/wfh
app.post("/api/employee/leave-action", (req, res) => {
  const { leave_id, action } = req.body;

  if (!leave_id || !["Accepted", "Rejected"].includes(action)) {
    return res.status(400).json({ error: "Invalid input" });
  }

  // Step 1: Get leave details
  const getLeaveQuery = `
    SELECT id, user_id, type, status, leave_wfh 
    FROM leave_requests 
    WHERE id = ?
  `;

  db.get(getLeaveQuery, [leave_id], (err, leave) => {
    if (err || !leave) {
      console.error("Leave lookup failed:", err?.message);
      return res.status(404).json({ error: "Leave not found" });
    }

    if (leave.status !== "Pending") {
      return res.status(400).json({ error: "Leave already processed" });
    }

    const { user_id, type } = leave;

    // If rejected, update status only
    if (action === "Rejected") {
      const update = `UPDATE leave_requests SET status = 'Rejected' WHERE id = ?`;
      return db.run(update, [leave_id], function (err) {
        if (err)
          return res.status(500).json({ error: "Failed to update status" });
        return res.status(200).json({ message: "Rejected successfully" });
      });
    }

    //Accept if leave_wfh = WFH
    if (leave.leave_wfh === "WFH") {
      const wfhupdate = `UPDATE leave_requests SET status = 'Accepted' WHERE id = ?`;
      return db.run(wfhupdate, [leave_id], function (err) {
        if (err)
          return res.status(500).json({ error: "Failed to update status" });
        return res.status(200).json({ message: "WFH accepted successfully" });
      });
    } else {
      // Leave Accepted: Check and update pending leaves
      let leaveColumn = "";
      if (type === "Sick Leave") leaveColumn = "pending_sick_leaves";
      else if (type === "Casual Leave") leaveColumn = "pending_casual_leaves";
      else if (type === "Earned Leave") leaveColumn = "pending_earned_leaves";

      //else return res.status(400).json({ error: "Invalid leave type" });

      // Step 2: Get pending leave count
      const getPending = `SELECT ${leaveColumn} FROM leave_master WHERE user_id = ?`;

      db.get(getPending, [user_id], (err, result) => {
        if (err || !result) {
          console.error("leave_master fetch error:", err?.message);
          return res.status(500).json({ error: "Leave master not found" });
        }

        if (result[leaveColumn] <= 0) {
          return res.status(400).json({ error: `No Pending ${type}` });
        }

        // Step 3: Update status and decrement leave
        const updateLeave = `UPDATE leave_requests SET status = 'Accepted' WHERE id = ?`;

        db.get(
          `SELECT duration FROM leave_requests WHERE id = ?`,
          [leave_id],
          (err, row) => {
            if (err)
              return res
                .status(500)
                .json({ error: "Failed to fetch leave type" });

            const duration = row?.duration;
            if (!duration)
              return res
                .status(400)
                .json({ error: "Leave duration not found" });

            const decrement = duration === "Half Day" ? 0.5 : 1;
            const updateMaster = `UPDATE leave_master SET ${leaveColumn} = ${leaveColumn} - ? WHERE user_id = ?`;

            db.serialize(() => {
              db.run(updateLeave, [leave_id], function (err) {
                if (err)
                  return res
                    .status(500)
                    .json({ error: "Failed to update leave status" });

                db.run(updateMaster, [decrement, user_id], function (err) {
                  if (err)
                    return res
                      .status(500)
                      .json({ error: "Failed to update leave balance" });
                  return res
                    .status(200)
                    .json({ message: "Leave accepted and balance updated" });

                });
              });
            });
          }
        );
      });
    }
  });
});

//Fetch Employees under a Manager
app.post("/api/manager/employees", (req, res) => {
  const { username } = req.body;

  if (!username) {
    return res.status(400).json({ error: "Username is required" });
  }

  // Step 1: Get manager ID
  const getManagerIdQuery = `SELECT id FROM users WHERE username = ?`;
  db.get(getManagerIdQuery, [username], (err, manager) => {
    if (err || !manager) {
      console.error("Manager lookup error:", err?.message);
      return res.status(404).json({ error: "Manager not found" });
    }

    const managerId = manager.id;

    // Step 2: Get all employee_ids under this manager
    const getEmployeeIdsQuery = `
      SELECT employee_id FROM employee_manager WHERE manager_id = ?
    `;
    db.all(getEmployeeIdsQuery, [managerId], (err, rows) => {
      if (err) {
        console.error("Employee ID fetch error:", err.message);
        return res.status(500).json({ error: "Error fetching employee list" });
      }

      if (!rows.length) {
        return res.status(200).json({ employees: [] }); // No direct reports
      }

      const employeeIds = rows.map((r) => r.employee_id);
      const placeholders = employeeIds.map(() => "?").join(",");

      // Step 3: Get employee data from employee table
      const getEmployeesQuery = `
        SELECT * FROM employee WHERE user_id IN (${placeholders})
      `;

      db.all(getEmployeesQuery, employeeIds, (err, employeeData) => {
        if (err) {
          console.error("Employee data fetch error:", err.message);
          return res
            .status(500)
            .json({ error: "Error retrieving employee details" });
        }

        res.status(200).json({ employees: employeeData });
      });
    });
  });
});

// Fetch Employee Data Using username
app.post("/api/employee/details", (req, res) => {
  const { username } = req.body;

  if (!username) {
    return res
      .status(400)
      .json({ error: "username is required in request body" });
  }

  // Step 1: Check if user exists
  db.get(
    "SELECT * FROM users WHERE username = ?",
    [username],
    (err, userRow) => {
      if (err)
        return res
          .status(500)
          .json({ error: "Database error", details: err.message });
      if (!userRow) return res.status(404).json({ error: "User not found" });

      // Step 2: Get employee details for that user_id
      db.get(
        "SELECT * FROM employee WHERE user_id = ?",
        [userRow.id],
        (err, empRow) => {
          if (err)
            return res
              .status(500)
              .json({ error: "Database error", details: err.message });
          if (!empRow)
            return res
              .status(404)
              .json({ error: "Employee details not found" });

          return res.json(empRow);
        }
      );
    }
  );
});

// Update editable employee profile fields
app.post("/api/employee/update-profile", (req, res) => {
  const { username, email, address, dob, marital_status, blood_group } =
    req.body;

  if (!username) return res.status(400).json({ error: "Username is required" });

  db.get(
    "SELECT * FROM users WHERE username = ?",
    [username],
    (err, userRow) => {
      if (err || !userRow)
        return res.status(404).json({ error: "User not found" });

      db.run(
        `
      UPDATE employee SET
        email = ?,
        address = ?,
        dob = ?,
        marital_status = ?,
        blood_group = ?
      WHERE user_id = ?
    `,
        [email, address, dob, marital_status, blood_group, userRow.id],
        function (err) {
          if (err)
            return res
              .status(500)
              .json({ error: "Database update failed", details: err.message });

          res.json({ success: true });
        }
      );
    }
  );
});

app.get("/api/employee/home-summary", async (req, res) => {
  const username = req.query.username;
  if (!username) return res.status(400).json({ error: "username is required" });

  try {
    db.get(
      "SELECT * FROM users WHERE username = ?",
      [username],
      (err, userRow) => {
        if (err || !userRow)
          return res
            .status(500)
            .json({ error: "User not found", details: err });

        const userId = userRow.id;

        // Fetch employee details
        db.get(
          "SELECT * FROM employee WHERE user_id = ?",
          [userId],
          async (err, empRow) => {
            if (err || !empRow)
              return res
                .status(500)
                .json({ error: "Employee not found", details: err });

            const today = new Date().toISOString().split("T")[0];
            const tomorrow = new Date(Date.now() + 86400000)
              .toISOString()
              .split("T")[0];

            // Parallel Queries
            const queries = {
              // Who's on leave
              leavesToday: `SELECT fullname, department FROM employee 
                          JOIN leave_requests ON employee.user_id = leave_requests.user_id
                          WHERE leave_requests.from_date <= ? AND leave_requests.to_date >= ? AND leave_requests.status = 'Accepted' AND leave_requests.leave_wfh = 'Leave'`,
              leavesTomorrow: `SELECT fullname, department FROM employee 
                          JOIN leave_requests ON employee.user_id = leave_requests.user_id
                          WHERE from_date <= ? AND to_date >= ? AND status = 'Accepted' AND leave_wfh = 'Leave'`,

              // Birthdays today or this week
              birthdays: `SELECT fullname, department FROM employee 
                      WHERE strftime('%m-%d', dob) = strftime('%m-%d', DATE('now')) 
                      `,

              // Upcoming holidays
              holidays: `SELECT occasion, date FROM holidays 
                     WHERE date >= DATE('now') ORDER BY date ASC LIMIT 3`,

              // Notifications
              notifications: `SELECT type, message, created_at FROM hr_notifications 
                          ORDER BY created_at DESC LIMIT 5`,

              // Internal job postings
              jobs: `SELECT title, department FROM job_postings 
                 WHERE status = 'Active' ORDER BY created_at DESC LIMIT 5`,

              // Get pending leaves
              pending_leaves: `SELECT pending_casual_leaves, pending_sick_leaves, pending_earned_leaves FROM leave_master 
                 WHERE user_id = ?`,
            };

            // Run all parallel
            db.all(
              queries.leavesToday,
              [today, today],
              (err, todayLeaveRows) => {
                db.all(
                  queries.leavesTomorrow,
                  [tomorrow, tomorrow],
                  (err, tomorrowLeaveRows) => {
                    db.all(queries.birthdays, [], (err, birthdayRows) => {
                      db.all(queries.holidays, [], (err, holidayRows) => {
                        db.all(
                          queries.notifications,
                          [],
                          (err, notificationRows) => {
                            db.all(queries.jobs, [], (err, jobRows) => {
                              db.get(
                                queries.pending_leaves,
                                [userId],
                                (err, leaveRow) => {
                                  return res.json({
                                    fullname: empRow.fullname,
                                    position: empRow.position,
                                    reporting_manager: empRow.reporting_manager,
                                    joining_date: empRow.joining_date,
                                    email: empRow.email,

                                    remaining_cl:
                                      leaveRow?.pending_casual_leaves || 0,
                                    remaining_sl:
                                      leaveRow?.pending_sick_leaves || 0,
                                    remaining_el:
                                      leaveRow?.pending_earned_leaves || 0,

                                    leave_today: todayLeaveRows || [],
                                    leave_tomorrow: tomorrowLeaveRows || [],
                                    birthdays: birthdayRows || [],
                                    holidays: holidayRows || [],
                                    notifications: notificationRows || [],
                                    jobs: jobRows || [],
                                  });
                                }
                              );
                            });
                          }
                        );
                      });
                    });
                  }
                );
              }
            );
          }
        );
      }
    );
  } catch (err) {
    return res
      .status(500)
      .json({ error: "Server error", details: err.message });
  }
});

// GET: Fetch all employees for a given org_id
app.get("/api/fetch_employees", async (req, res) => {
  const org_id = parseInt(req.query.org_id, 10);

  if (!org_id) {
    return res.status(400).json({ error: "Missing or invalid org_id" });
  }

  try {
    const rows = await db.query("SELECT * FROM employee WHERE org_id = $1", [
      org_id,
    ]);

    res.json({ data: rows });
  } catch (err) {
    console.error("Error fetching employees:", err);
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
        org_id = ?,
        fullname = ?,
        gender = ?,
        dob = ?,
        email = ?,
        mobile = ?,
        joining_date = ?,
        emp_code = ?,
        department = ?,
        position = ?,
        address = ?,
        blood_group = ?,
        marital_status = ?,
        reporting_manager = ?,
        cityfrom = ?,
        profile_photo = ?,
        about = ?,
        hobbies = ?,
        linkedin = ?
      WHERE user_id = ?
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

    const result = await dbRunAsync(updateQuery, values);

    if (result.changes === 0) {
      return res
        .status(404)
        .json({ error: "Employee not found or no changes made" });
    }

    res.json({ success: true, message: "Employee updated successfully" });
  } catch (err) {
    console.error("Error updating employee:", err);
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
    const userInsert = await dbRunAsync(
      `INSERT INTO users (
        org_id, fullname, user_type, username, password
      ) VALUES (?, ?, ?, ?, ?)`,
      [org_id, fullname, user_type, username, password]
    );

    const user_id = userInsert.lastID;

    // 2. Insert into employee table
    const employeeInsert = await dbRunAsync(
      `INSERT INTO employee (
        org_id, user_id, fullname, emp_code, position, department
      ) VALUES (?, ?, ?, ?, ?, ?)`,
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
