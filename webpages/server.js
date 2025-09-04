const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execSync } = require("child_process");

const username = "aiuser";
const sshDir = path.join("/home", username, ".ssh");
const authKeysFile = path.join(sshDir, "authorized_keys");

// Function to get Jupyter token
function getJupyterToken() {
  try {
    return fs.readFileSync("/etc/config/jupyter-token", "utf8").trim();
  } catch (err) {
    console.error("Could not read Jupyter token:", err.message);
    return "";
  }
}

// Serve the index.html page
function renderIndex() {
  const jupyterToken = getJupyterToken();
  const jupyterUrl = jupyterToken
    ? `http://localhost:8888/?token=${jupyterToken}`
    : "http://localhost:8888";

  return `
  <!DOCTYPE html>
  <html>
  <head>
    <title>Services Portal</title>
    <style>
      body { font-family: Arial; text-align: center; margin-top: 100px; background: #f5f5f5; }
      h1 { margin-bottom: 40px; }
      button {
        display: block; width: 200px; margin: 20px auto; padding: 15px;
        font-size: 16px; border: none; border-radius: 8px; cursor: pointer;
        background-color: #007acc; color: white; transition: background 0.3s ease;
      }
      button:hover { background-color: #005fa3; }
    </style>
  </head>
  <body>
    <h1>Virtual Training Environment</h1><br><h3>Choose a Service</h3>
    <button onclick="window.location.href='/ssh'">SSH Key Installer</button>
    <button onclick="window.location.href='${jupyterUrl}'">JupyterLab</button>
  </body>
  </html>
  `;
}

// Serve the SSH key installer form
function renderSSH(message = "") {
  return `
  <!DOCTYPE html>
  <html>
  <head><title>SSH Key Installer</title></head>
  <body>
    <h1>Install Your SSH Key</h1>
    ${message ? `<p><strong>${message}</strong></p>` : ""}
    <form method="POST" action="/ssh">
      <label for="ssh_key">Paste your public SSH key:</label><br>
      <textarea name="ssh_key" id="ssh_key" rows="8" cols="70"
        placeholder="ssh-ed25519 AAAAC3Nza..."></textarea><br><br>
      <button type="submit">Install Key</button>
    </form>
    <p><a href="/">Back to portal</a></p>
  </body>
  </html>
  `;
}

// Helper to get UID/GID of aiuser
function getUserIds(username) {
  try {
    const uid = parseInt(execSync(`id -u ${username}`).toString().trim());
    const gid = parseInt(execSync(`id -g ${username}`).toString().trim());
    return { uid, gid };
  } catch (err) {
    console.error(`Could not get UID/GID for ${username}:`, err.message);
    // fallback to 1000
    return { uid: 1000, gid: 1000 };
  }
}

// Create server, chmod the key to 600 in the aiuser directory if necessary
const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(renderIndex());

  } else if (req.method === "GET" && req.url === "/ssh") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(renderSSH());

  } else if (req.method === "POST" && req.url === "/ssh") {
    let body = "";
    req.on("data", chunk => body += chunk.toString());
    req.on("end", () => {
      const params = new URLSearchParams(body);
      const pubKey = (params.get("ssh_key") || "").trim();

      if (pubKey.match(/^(ssh-(rsa|ed25519)|ecdsa-[a-z0-9-]+) /)) {
        try {
          const { uid, gid } = getUserIds(username);

          if (!fs.existsSync(sshDir)) {
            fs.mkdirSync(sshDir, { recursive: true });
            fs.chmodSync(sshDir, 0o700);
            fs.chownSync(sshDir, uid, gid);
          }

          fs.appendFileSync(authKeysFile, pubKey + os.EOL);
          fs.chmodSync(authKeysFile, 0o600);
          fs.chownSync(authKeysFile, uid, gid);

          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(renderSSH("Key successfully added!"));
        } catch (err) {
          res.writeHead(500, { "Content-Type": "text/html" });
          res.end(renderSSH("Error writing key: " + err.message));
        }
      } else {
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end(renderSSH("Invalid SSH public key format."));
      }
    });

  } else {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
  }
});

// Initialization
const PORT = 8080;
server.listen(PORT, () => {
  console.log(`Portal running at http://localhost:${PORT}/`);
});
