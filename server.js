const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const pool = require("./db");

const app = express();
const PORT = process.env.PORT || 3000;
function adminAuth(req, res, next) {
    const password = req.headers["x-admin-password"];

    if (password !== process.env.ADMIN_PASSWORD) {
        return res.status(401).json({
            success: false,
            message: "Accès admin refusé"
        });
    }

    next();
}

app.use(cors());
app.use(express.json());

const BEATS_DIR = path.join(__dirname, "beats");

// Convert PostgreSQL row to the format used by the admin page
function formatOrder(row) {
    return {
        id: row.id,
        date: row.date,
        name: row.name,
        email: row.email,
        beat: row.beat,
        license: row.license,
        price: row.price,
        paymentMethod: row.payment_method,
        mvolaNumber: row.mvola_number,
        transactionReference: row.transaction_reference,
        message: row.message,
        status: row.status,
        downloadToken: row.download_token,
        downloadUsed: row.download_used,
        downloadExpiresAt: row.download_expires_at,
        verifiedAt: row.verified_at,
        downloadedAt: row.downloaded_at
    };
}

// Health check
app.get("/api/health", (req, res) => {
    res.json({
        success: true,
        message: "RAYAZ RECORDS backend is running"
    });
});

// Get all orders
app.get("/api/orders", adminAuth, async (req, res) => {
    try {
        const result = await pool.query(
            "SELECT * FROM orders ORDER BY date DESC"
        );

        const orders = result.rows.map(formatOrder);

        res.json({
            success: true,
            orders: orders
        });

    } catch (error) {
        console.error("Erreur récupération commandes :", error);

        res.status(500).json({
            success: false,
            message: "Erreur database"
        });
    }
});

// Create order
app.post("/api/orders", async (req, res) => {
    try {
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
            downloadExpiresAt: null,
            verifiedAt: null,
            downloadedAt: null
        };

        await pool.query(
            `INSERT INTO orders (
                id,
                date,
                name,
                email,
                beat,
                license,
                price,
                payment_method,
                mvola_number,
                transaction_reference,
                message,
                status,
                download_token,
                download_used,
                download_expires_at,
                verified_at,
                downloaded_at
            )
            VALUES (
                $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
                $11,$12,$13,$14,$15,$16,$17
            )`,
            [
                order.id,
                order.date,
                order.name,
                order.email,
                order.beat,
                order.license,
                order.price,
                order.paymentMethod,
                order.mvolaNumber,
                order.transactionReference,
                order.message,
                order.status,
                order.downloadToken,
                order.downloadUsed,
                order.downloadExpiresAt,
                order.verifiedAt,
                order.downloadedAt
            ]
        );

        console.log("Nouvelle commande :", order.id);

        res.json({
            success: true,
            message: "Commande recue",
            orderId: order.id
        });

    } catch (error) {
        console.error("Erreur création commande :", error);

        res.status(500).json({
            success: false,
            message: "Erreur database"
        });
    }
});

// Verify payment
app.post("/api/orders/:id/verify", async (req, res) => {
    const password = req.headers["x-admin-password"];
    if (password !== process.env.ADMIN_PASSWORD) {
        return res.status(401).json({ success: false, message: "Accès admin refusé" });
    }
    try {
        const result = await pool.query(
            "SELECT * FROM orders WHERE id = $1",
            [req.params.id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Commande introuvable"
            });
        }

        const token = crypto.randomBytes(32).toString("hex");

        const expiration =
            new Date(Date.now() + 30 * 60 * 1000);

        const updateResult = await pool.query(
            `UPDATE orders
             SET
                status = 'VERIFIED',
                verified_at = NOW(),
                download_token = $1,
                download_used = FALSE,
                download_expires_at = $2
             WHERE id = $3
             RETURNING *`,
            [
                token,
                expiration.toISOString(),
                req.params.id
            ]
        );

        const order = formatOrder(updateResult.rows[0]);

        const protocol =
            req.headers["x-forwarded-proto"] || req.protocol;

        const downloadLink =
            protocol +
            "://" +
            req.get("host") +
            "/download/" +
            token;

        console.log("Paiement valide :", order.id);
        console.log("Download link :", downloadLink);
        console.log("Expiration :", order.downloadExpiresAt);

        res.json({
            success: true,
            message: "Paiement valide",
            order: order,
            downloadLink: downloadLink,
            expiresAt: order.downloadExpiresAt
        });

    } catch (error) {
        console.error("Erreur validation paiement :", error);

        res.status(500).json({
            success: false,
            message: "Erreur database"
        });
    }
});

// Protected download
app.get("/download/:token", async (req, res) => {
    try {
        const result = await pool.query(
            "SELECT * FROM orders WHERE download_token = $1",
            [req.params.token]
        );

        if (result.rows.length === 0) {
            return res.status(404).send(
                "Lien de telechargement invalide."
            );
        }

        const row = result.rows[0];

        if (row.status !== "VERIFIED") {
            return res.status(403).send(
                "Paiement non valide."
            );
        }

        if (row.download_used === true) {
            return res.status(403).send(
                "Ce lien a deja ete utilise."
            );
        }

        if (
            row.download_expires_at &&
            Date.now() >
            new Date(row.download_expires_at).getTime()
        ) {
            return res.status(403).send(
                "Ce lien de telechargement a expire."
            );
        }

        let fileName = "";

        if (row.beat === "RAYAZ AFRO BEAT") {
            fileName = "beat1.mp3";
        }

        if (row.beat === "RAYAZ TRAP BEAT") {
    fileName = "beat2.mp3";
}

        if (
            row.beat ===
            "BURNA BOY TYPE BEAT AFRODANCEHALL 2026"
        ) {
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

        // Mark download as used
        await pool.query(
            `UPDATE orders
             SET
                download_used = TRUE,
                downloaded_at = NOW()
             WHERE id = $1`,
            [row.id]
        );

        res.download(filePath, fileName);

    } catch (error) {
        console.error("Erreur téléchargement :", error);

        res.status(500).send(
            "Erreur serveur."
        );
    }
});

// Block direct access to full beats
app.use("/beats", (req, res) => {
    res.status(403).send(
        "Accès direct au fichier interdit."
    );
});

// Public files: index.html, previews, admin.html, etc.
app.use(express.static(__dirname));

app.get("/", (req, res) => {
    res.sendFile(
        path.join(__dirname, "index.html")
    );
});

app.listen(PORT, () => {
    console.log(
        "RAYAZ RECORDS backend demarre sur le port " +
        PORT
    );
});