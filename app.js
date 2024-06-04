// Call in all required libraries and modules
const express = require("express");
const bodyParser = require("body-parser");
const fs = require("fs");
const csv = require("csv-parser");
const path = require("path");
const app = express();
const multer = require("multer");
const createCsvWriter = require("csv-writer").createObjectCsvWriter;
const upload = multer({ dest: "uploads/" });
const { parse } = require("csv-parse");
const dir = path.join(__dirname, "public");
const { exec } = require("child_process");
const { spawn } = require('child_process');
const grepPath = path.join(__dirname, `/KHdebug/`);
const async = require("async");

if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true });
}
app.use(bodyParser.urlencoded({ extended: true }));
app.use("/assets", express.static(path.join(__dirname, "public/assets")));
app.set("views", path.join(__dirname, "views"));
app.set("view engine", "ejs");
// app.use('/assets', express.static('assets'));



// .get route for the index page (home page) 

app.get("/", (req, res) => {
  // Spawn a new process and then exit the process to avoid reaching the buffer limit of the child process 
  const find = spawn('find', [grepPath, '-type', 'f', '-mtime', '0']);
  let output = '';

  find.stdout.on('data', (data) => {
    output += data;
  });

  find.stderr.on('data', (data) => {
    console.error(`stderr: ${data}`);
  });

  find.on('close', (code) => {
    if (code !== 0) {
      console.log(`find process exited with code ${code}`);
    } else {
      let fileNames = output.split("\n");
      let completedCounts = Array(24).fill(0);
      let failedCounts = Array(24).fill(0);
      // console.log(`Found ${fileNames.length} files`);
      async.each(
        fileNames,
        (fileName, callback) => {
          let lastSix = fileName.slice(-6);
          let match = lastSix.match(/[0-9]{6}/);
          //  console.log(`${match}`)
          if (match) {
            let hour = parseInt(match[0].substring(0, 2), 10);
            fs.readFile(fileName, "utf8", (err, data) => {
              if (err) {
                console.error(`readFile error: ${err}`);
                return callback(err);
              }
              if (data.includes("completed")) {
                completedCounts[hour]++;
              } else if (data.includes("failed")) {
                failedCounts[hour]++;
              }
              callback();
            });
        } else {
          callback();
        }
      },
      (err) => {
        if (err) {
          console.error(`async error: ${err}`);
          return;
        }
        //            console.log(`completedCounts: ${completedCounts}`);
        //           console.log(`failedCounts: ${failedCounts}`);
        res.render("index", { completedCounts, failedCounts });
      }
    );
  }
  });
});

app.get("/faillog", (req, res) => {
  res.render("faillog");
});

app.post("/view", (req, res) => {
  let date = req.body.date;
  if (!date) {
    let today = new Date();
    let dd = String(today.getDate()).padStart(2, "0");
    let mm = String(today.getMonth() + 1).padStart(2, "0"); //January is 0!
    let yyyy = today.getFullYear();
    date = yyyy + mm + dd;
  } else {
    date = date.replace(/-/g, "");
  }
  const filePath = path.join(__dirname, `/KHdebug/${date}_Faillog.csv`);

  let data = [];
  const readStream = fs.createReadStream(filePath);
  readStream
    .on("error", function (err) {
      if (err.code === "ENOENT") {
        console.error("File not found");
        res.status(404).send("File not found");
      } else {
        console.error(err);
        res.status(500).send("An error occurred");
      }
    })
    .pipe(csv())
    .on("data", (row) => {
      data.push(row);
    })
    .on("end", () => {
      res.render("view", { data: data });
    });
});


// The below function getDataForDate is used to get the data for a specific date
// The function reads the files in the directory for the given date and processes them
// The data is then returned to the callback function
// The data is an object with the hour as the key and the number of completed and failed logs as the value
function getDataForDate(date, callback) {
  date = date.split("-").join(""); // Convert date from YYYY-MM-DD to YYYYMMDD
  const dirPath = path.join(__dirname, `/KHdebug/${date}/`);
  let results = {};

  fs.readdir(dirPath, (err, directories) => {
    if (err) {
      callback(err);
      return;
    }

    directories.sort(); // Sort the directories

    let totalFiles = 0;
    let processedFiles = 0;

    directories.forEach((directory, index) => {
      const directoryPath = path.join(dirPath, directory);

      fs.readdir(directoryPath, (err, files) => {
        if (err) {
          callback(err);
          return;
        }

        files.sort(); // Sort the files

        totalFiles += files.length;

        files.forEach((file, index) => {
          const filePath = path.join(directoryPath, file);

          fs.readFile(filePath, "utf8", (err, data) => {
            if (err) {
              callback(err);
              return;
            }

            const hour = directory; // The directory name is the hour
            if (!results[hour]) {
              results[hour] = { completed: 0, failed: 0 };
            }

            if (data.includes("completed")) {
              results[hour].completed += 1;
            } else if (data.includes("failed")) {
              results[hour].failed += 1;
            }

            processedFiles += 1;

            if (processedFiles === totalFiles) {
              // If all files have been processed
              callback(null, results);
            }
          });
        });
      });
    });
  });
}

// This route is used to get the data for a specific date
// The data is then rendered in the dateResult page
app.get("/date/:date", (req, res) => {
  getDataForDate(req.params.date, (err, data) => {
    if (err) {
      console.error(err);
      res.status(500).send("An error occurred");
      return;
    }

    res.render("dateResult", { data });
  });
});

app.get("/graph", (req, res) => {
  getDataForDate(req.query.date, (err, data) => {
    if (err) {
      console.error(err);
      res.status(500).send("An error occurred");
      return;
    }

    if (!data) {
      res.status(404).send({ error: "Data not found for the provided date" });
      return;
    }

    res.json(data);
  });
});

app.get("/date", (req, res) => {
  res.render("date"); // Render the page with the form
});

app.get("/lastweek", (req, res) => {
  const dirPath = path.join(__dirname, "/KHdebug/");
  let data = [];
  let fileReads = [];

  for (let i = 0; i < 7; i++) {
    let date = new Date();
    date.setDate(date.getDate() - i);
    let dd = String(date.getDate()).padStart(2, "0");
    let mm = String(date.getMonth() + 1).padStart(2, "0"); //January is 0!
    let yyyy = date.getFullYear();
    let dateStr = yyyy + mm + dd;
    let filePath = path.join(dirPath, `${dateStr}_Faillog.csv`);

    let readStream = fs
      .createReadStream(filePath)
      .on("error", function (err) {
        if (err.code !== "ENOENT") {
          console.error(err);
        }
      })
      .pipe(csv())
      .on("data", (row) => {
        data.push(row);
      });
    fileReads.push(
      new Promise((resolve) => {
        readStream.on("end", resolve);
      })
    );
  }

  Promise.all(fileReads).then(() => {
    res.render("lastweek", { data: data });
  });
});

app.get("/lastmonth", (req, res) => {
  const dirPath = path.join(__dirname, "/KHdebug/");
  let data = [];
  let fileReads = [];

  for (let i = 0; i < 30; i++) {
    let date = new Date();
    date.setDate(date.getDate() - i);
    let dd = String(date.getDate()).padStart(2, "0");
    let mm = String(date.getMonth() + 1).padStart(2, "0"); //January is 0!
    let yyyy = date.getFullYear();
    let dateStr = yyyy + mm + dd;
    let filePath = path.join(dirPath, `${dateStr}_Faillog.csv`);

    let readStream = fs
      .createReadStream(filePath)
      .on("error", function (err) {
        if (err.code !== "ENOENT") {
          console.error(err);
        }
      })
      .pipe(csv())
      .on("data", (row) => {
        data.push(row);
      });

    fileReads.push(
      new Promise((resolve) => {
        readStream.on("end", resolve);
      })
    );
  }

  Promise.all(fileReads).then(() => {
    res.render("lastmonth", { data: data });
  });
});

app.get("/search", (req, res) => {
  res.render("search");
});

app.post("/searchresults", (req, res) => {
  let userInput = req.body.userInput;
  if (!userInput) {
    return res.status(400).send("User input is required");
  }
  let command = `grep -hR Subject ${grepPath}* | grep ${userInput}`;

  exec(command, (error, stdout, stderr) => {
    if (error) {
      console.error(`exec error: ${error}`);
      return res.status(500).send("An error occurred");
    }
    let data = stdout.split("\n").map((line) => line.replace(/Subject:/g, ""));
    res.render("searchresults", { data: data, userInput: userInput });
  });
});

app.get("/searchresults", (req, res) => {
  let userInput = req.query.userReferred;
  if (!userInput) {
    return res.status(400).send("User input is required");
  }
  let command = `grep -hR Subject ${grepPath}/* | grep ${userInput}`;

  exec(command, (error, stdout, stderr) => {
    if (error) {
      console.error(`exec error: ${error}`);
      return res.status(500).send("An error occurred");
    }
    let data = stdout.split("\n").map((line) => line.replace(/Subject:/g, ""));
    res.render("searchresults", { data: data, userInput: userInput });
  });
});

app.get("/review", (req, res) => {
  let userInput = req.query.ufaxStrings;
  let grepCommand = `grep -lR ${userInput} ${grepPath}/* | grep -v csv`;

  exec(grepCommand, (grepError, grepStdout, grepStderr) => {
    if (grepError) {
      console.error(`exec error: ${grepError}`);
      return res.status(500).send("An error occurred");
    }

    let fileName = grepStdout.trim(); // Remove trailing newline
    let catCommand = `cat ${fileName}`;

    exec(catCommand, (catError, catStdout, catStderr) => {
      if (catError) {
        console.error(`exec error: ${catError}`);
        return res.status(500).send("An error occurred");
      }
      let data = catStdout.split("\n");
      res.render("review", { data: data, userInput: userInput });
    });
  });
});

app.post("/upload", upload.single("file"), (req, res) => {
  let filePath = req.file.path;
  let data = [];
  let fileReads = [];

  // Get today's date
  let today = new Date();

  // Read the last 7 days of fail logs into memory
  let failLogs = [];
  // const parse = require('csv-parse');

  for (let i = 0; i < 7; i++) {
    let date = new Date();
    date.setDate(today.getDate() - i);
    let dateStr = date.toISOString().slice(0, 10).replace(/-/g, "");
    let failLogFilePath = `${grepPath}${dateStr}_Faillog.csv`;

    if (fs.existsSync(failLogFilePath)) {
      let failLogData = fs.readFileSync(failLogFilePath, "utf8");

      if (failLogData.trim() !== "") {
        let parser = parse(failLogData, {
          skip_empty_lines: true,
        });

        parser.on("readable", function () {
          let record;
          while ((record = parser.read())) {
            failLogs.push(record);
          }
        });

        parser.on("error", function (err) {
          console.log("Error reading CSV data:", err.message);
        });
      }
    }
  }
  const csvWriter = require("csv-writer").createObjectCsvWriter({
    path: "public/updated.csv",
    header: [
      { id: "status", title: "Status" },
      { id: "title", title: "title" },
      { id: "surname", title: "surname" },
      { id: "given_name", title: "given_name" },
      { id: "report_name", title: "report_name" },
      { id: "address_1", title: "address_1" },
      { id: "address_2", title: "address_2" },
      { id: "address_3", title: "address_3" },
      { id: "city", title: "city" },
      { id: "state", title: "state" },
      { id: "postcode", title: "postcode" },
      { id: "dtype", title: "dtype" },
      { id: "sales_territory", title: "sales_territory" },
      { id: "area", title: "area" },
      { id: "surgery", title: "surgery" },
      { id: "telephone", title: "telephone" },
      { id: "home_phone", title: "home_phone" },
      { id: "service_phone", title: "service_phone" },
      { id: "pref_name", title: "pref_name" },
      { id: "lookup", title: "lookup" },
      { id: "edi_address", title: "edi_address" },
      { id: "num", title: "num" },
      { id: "code", title: "code" },
      { id: "fax_phone", title: "Fax Phone" },
      { id: "info", title: "info" },
      { id: "edi", title: "edi" },
      { id: "interim", title: "interim" },
      { id: "complete", title: "complete" },
      { id: "MEDWAY", title: "MEDWAY" },
      { id: "fail_reason", title: "Fail Reason" },
      // Add more headers as needed
    ],
  });
  fs.createReadStream(filePath)
    .pipe(csv())
    .on("data", (row) => {
      let faxPhone = row["fax_phone"];
      if (faxPhone) {
        // Convert faxPhone to string and remove leading "0"
        faxPhone = faxPhone.toString();
        if (faxPhone.startsWith("0")) {
          faxPhone = faxPhone.slice(1);
        }

        // Search for the faxPhone in the fail logs
        let found = false;
        let failReason = "";
        for (let i = 0; i < failLogs.length && !found; i++) {
          let failLogData = failLogs[i];
          let failLogFaxPhone = failLogData[3];
          console.log(`${failLogFaxPhone}`);
          // Convert failLogFaxPhone to string and remove leading "0"
          failLogFaxPhone = failLogFaxPhone.toString();
          if (failLogFaxPhone.startsWith("0")) {
            failLogFaxPhone = failLogFaxPhone.slice(1);
          }

          if (failLogFaxPhone === faxPhone) {
            found = true;
            failReason = failLogData[4]; // Assuming the fail reason is in the 5th column (index 4)
            break;
          }
        }

        if (found) {
          // Handle the case where the faxPhone is found in the fail logs
          // console.log(`Fax phone ${faxPhone} found in fail logs`);
          row["status"] = "failed";
          // Check if the Fax phone has ever worked

          exec(
            `grep -hR Subject ${grepPath}* | grep ${faxPhone} | grep -v failed`,
            (error, stdout, stderr) => {
              if (stdout) {
                row["status"] = "mixed";
              }
            }
          );
          row["fail_reason"] = failReason;
        } else {
          // Handle the case where the faxPhone is not found in the fail logs
          // console.log(`Fax phone ${faxPhone} not found in fail logs`);
          row["status"] = "success";
        }

        data.push(row);
      }
    })
    .on("end", () => {
      // All rows have been read, write the data to a CSV file
      csvWriter.writeRecords(data).then(() => {
        console.log("The CSV file was written successfully");
        // Send the file back to the client for download
        res.download(path.join(__dirname, "public", "updated.csv"));
      });
    });
});
app.get("/upload", (req, res) => {
  res.render("upload", { data: [], csvPath: null });
});

app.get("/download", (req, res) => {
  const file = path.join(__dirname, "public", "updated.csv");
  res.download(file);
});

app.listen(3000, () => console.log("Server started on port 3000"));
