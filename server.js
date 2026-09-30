const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

const ORDERS_FILE = path.join(__dirname, "orders.json");
const BEATS_DIR = path.join(__dirname, "beats");

if (!fs.existsSync(ORDERS_FILE)) {
fs.writeFileSync(ORDERS_FILE, "[]", "utf8");
}

function getOrders() {
return JSON.parse(fs.readFileSync(ORDERS_FILE, "utf8"));
}

function saveOrders(orders) {
fs.writeFileSync(
ORDERS_FILE,
JSON.stringify(orders, null, 2),
"utf8"
);
}

app.get("/api/health", (req, res) => {
res.json({
success: true,
message: "RAYAZ RECORDS backend is running"
});
});

app.get("/api/orders", (req, res) => {
const orders = getOrders();


res.json({
    success: true,
    orders: orders
});


});

app.post("/api/orders", (req, res) => {
const orders = getOrders();


const order = {
    id: "RAYAZ-" + Date.now(),
    date: new Date().toISOString(),
    name: req.body.name || "",
    email: req.body.email || "",
    beat: req.body.beat || "",
    license: req.body.license || "",
    price: req.body.price || "",
    paymentMethod: req.body.paymentMethod || "MVola",
    mvolaNumber: req.body.mvolaNumber || "",
    transactionReference: req.body.transactionReference || "",
    message: req.body.message || "",
    status: "PENDING",
    downloadToken: null,
    downloadUsed: false,
    downloadExpiresAt: null
};

orders.push(order);
saveOrders(orders);

console.log("Nouvelle commande :", order.id);

res.json({
    success: true,
    message: "Commande recue",
    orderId: order.id
});


});

app.post("/api/orders/:id/verify", (req, res) => {
const orders = getOrders();


const order = orders.find(
    item => item.id === req.params.id
);

if (!order) {
    return res.status(404).json({
        success: false,
        message: "Commande introuvable"
    });
}

order.status = "VERIFIED";
order.verifiedAt = new Date().toISOString();

const token = crypto.randomBytes(32).toString("hex");

order.downloadToken = token;
order.downloadUsed = false;

const expiration =
    Date.now() + (30 * 60 * 1000);

order.downloadExpiresAt =
    new Date(expiration).toISOString();

saveOrders(orders);

const downloadLink =
    "http://localhost:" +
    PORT +
    "/download/" +
    token;

console.log(
    "Paiement valide :",
    order.id
);

console.log(
    "Download link :",
    downloadLink
);

console.log(
    "Expiration :",
    order.downloadExpiresAt
);

res.json({
    success: true,
    message: "Paiement valide",
    order: order,
    downloadLink: downloadLink,
    expiresAt: order.downloadExpiresAt
});


});

app.get("/download/:token", (req, res) => {
const orders = getOrders();


const order = orders.find(
    item =>
        item.downloadToken === req.params.token
);

if (!order) {
    return res.status(404).send(
        "Lien de telechargement invalide."
    );
}

if (order.status !== "VERIFIED") {
    return res.status(403).send(
        "Paiement non valide."
    );
}

if (order.downloadUsed === true) {
    return res.status(403).send(
        "Ce lien a deja ete utilise."
    );
}

if (
    order.downloadExpiresAt &&
    Date.now() >
    new Date(order.downloadExpiresAt).getTime()
) {
    return res.status(403).send(
        "Ce lien de telechargement a expire."
    );
}

let fileName = "";

if (order.beat === "RAYAZ AFRO BEAT") {
    fileName = "beat1.mp3";
}

if (order.beat === "RAYAZ TRAP BEAT") {
    fileName = "beat2.mp3";
}

if (order.beat === "RAYAZ GOSPEL BEAT") {
    fileName = "beat3.mp3";
}

if (!fileName) {
    return res.status(404).send(
        "Beat introuvable."
    );
}

const filePath =
    path.join(BEATS_DIR, fileName);

if (!fs.existsSync(filePath)) {
    return res.status(404).send(
        "Fichier audio introuvable."
    );
}

order.downloadUsed = true;
order.downloadedAt =
    new Date().toISOString();

saveOrders(orders);

res.download(filePath, fileName);


});

app.use(express.static(__dirname));

app.get("/", (req, res) => {
res.sendFile(
path.join(__dirname, "index.html")
);
});

app.listen(PORT, () => {
console.log(
"RAYAZ RECORDS backend demarre sur http://localhost:3000"
);
});
