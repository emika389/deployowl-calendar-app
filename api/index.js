export default {
  async fetch(request, env) {
    // 1. OWL_GUARD bot & threat decision check
    try {
      const url = new URL(request.url);
      const guardResult = await env.OWL_GUARD.decision({
        ip: request.headers.get("cf-connecting-ip") || "127.0.0.1",
        method: request.method,
        pathname: url.pathname,
        headers: {
          "user-agent": request.headers.get("user-agent") || ""
        }
      });
      if (guardResult && guardResult.blocked) {
        return Response.json({
          error: "Request blocked by OwlGuard",
          reason: guardResult.reason || "Threat detected"
        }, {
          status: 403,
          headers: { "Access-Control-Allow-Origin": "*" }
        });
      }
    } catch (guardErr) {
      // Non-blocking fallback if OwlGuard is not configured/fails
      console.warn("OwlGuard evaluation skipped:", guardErr.message);
    }

    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // CORS preflight headers
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Content-Type": "application/json",
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      "Pragma": "no-cache",
      "Expires": "0"
    };

    if (method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // ─── PASSWORD HASHING UTILITIES (Web Crypto API) ───────────────────────────
    const PBKDF2_ITERATIONS = 100000;
    const SALT_LENGTH = 16;
    const HASH_LENGTH = 32;

    const bufferToHex = (buffer) => {
      const bytes = new Uint8Array(buffer);
      return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
    };

    const hexToBuffer = (hex) => {
      const bytes = new Uint8Array(hex.length / 2);
      for (let i = 0; i < hex.length; i += 2) {
        bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
      }
      return bytes.buffer;
    };

    const deriveHash = async (password, saltBuffer) => {
      const enc = new TextEncoder();
      const keyMaterial = await crypto.subtle.importKey(
        "raw",
        enc.encode(password),
        { name: "PBKDF2" },
        false,
        ["deriveBits"]
      );
      const derivedBits = await crypto.subtle.deriveBits(
        {
          name: "PBKDF2",
          salt: saltBuffer,
          iterations: PBKDF2_ITERATIONS,
          hash: "SHA-256"
        },
        keyMaterial,
        HASH_LENGTH * 8
      );
      return new Uint8Array(derivedBits);
    };

    const constantTimeCompare = (a, b) => {
      if (a.length !== b.length) return false;
      let result = 0;
      for (let i = 0; i < a.length; i++) {
        result |= a[i] ^ b[i];
      }
      return result === 0;
    };

    try {
      // ─── SIGNUP ROUTE ────────────────────────────────────────────────────────
      if (path === "/api/auth" && url.searchParams.get("action") === "signup" && method === "POST") {
        const { email, password, name } = await request.json();
        if (!email || !password) {
          return Response.json({ error: "Missing email or password" }, { status: 400, headers: corsHeaders });
        }

        // Enforce minimum password length
        if (password.length < 8) {
          return Response.json({ error: "Password must be at least 8 characters" }, { status: 400, headers: corsHeaders });
        }

        // Sanitizing ID (OWL_NOSQL ID requirement)
        const userId = email.replace(/[^a-zA-Z0-9_\-]/g, "_");

        // Check if user already exists
        const existingUser = await env.OWL_NOSQL.collection("users").find(userId);
        if (existingUser) {
          return Response.json({ error: "User already exists" }, { status: 409, headers: corsHeaders });
        }

        // Generate salt and hash the password via PBKDF2
        const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
        const hash = await deriveHash(password, salt.buffer);

        // Insert new user — store only the salted hash and salt, never the plaintext password
        const userData = {
          email,
          passwordSalt: bufferToHex(salt.buffer),
          passwordHash: bufferToHex(hash.buffer),
          name: name || "User",
          registeredAt: new Date().toISOString()
        };
        await env.OWL_NOSQL.collection("users").insert(userId, userData);

        // Send confirmation email via Resend SDK
        try {
          await env.RESEND.emails.send({
            from: "onboarding@resend.dev",
            to: email,
            subject: "Welcome to DeployOwl Calendar App!",
            html: `<h3>Hello ${name || 'User'}!</h3><p>Your account has been successfully created. Welcome aboard!</p>`
          });
        } catch (resendErr) {
          console.error("Resend confirmation email failed to send:", resendErr.message);
        }

        return Response.json({ success: true, message: "User registered successfully." }, { headers: corsHeaders });
      }

      // ─── LOGIN ROUTE ─────────────────────────────────────────────────────────
      if (path === "/api/auth" && url.searchParams.get("action") === "login" && method === "POST") {
        const { email, password } = await request.json();
        if (!email || !password) {
          return Response.json({ error: "Missing email or password" }, { status: 400, headers: corsHeaders });
        }

        const userId = email.replace(/[^a-zA-Z0-9_\-]/g, "_");
        const user = await env.OWL_NOSQL.collection("users").find(userId);

        if (!user || !user.passwordHash || !user.passwordSalt) {
          return Response.json({ error: "Invalid credentials" }, { status: 401, headers: corsHeaders });
        }

        // Derive hash from submitted password using stored salt and compare in constant time
        const storedSalt = hexToBuffer(user.passwordSalt);
        const submittedHash = await deriveHash(password, storedSalt);
        const storedHash = new Uint8Array(hexToBuffer(user.passwordHash));

        if (!constantTimeCompare(submittedHash, storedHash)) {
          return Response.json({ error: "Invalid credentials" }, { status: 401, headers: corsHeaders });
        }

        // DEPLOYOWL telemetry user assignment context
        try {
          env.DEPLOYOWL.setUser({ id: userId, email: user.email });
        } catch (telemetryErr) {
          console.warn("DeployOwl telemetry context failed:", telemetryErr.message);
        }

        return Response.json({
          success: true,
          user: { email: user.email, name: user.name, photo: user.photo }
        }, { headers: corsHeaders });
      }

      // ─── EVENTS GET ROUTE ────────────────────────────────────────────────────
      if (path === "/api/events" && method === "GET") {
        const email = url.searchParams.get("email");
        if (!email) {
          return Response.json({ error: "Email parameter required" }, { status: 400, headers: corsHeaders });
        }

        const userId = email.replace(/[^a-zA-Z0-9_\-]/g, "_");
        const userEvents = await env.OWL_NOSQL.collection("events").find(userId);

        return Response.json({
          success: true,
          events: (userEvents && userEvents.list) || []
        }, { headers: corsHeaders });
      }

      // ─── EVENTS SAVE ROUTE ───────────────────────────────────────────────────
      if (path === "/api/events" && url.searchParams.get("action") === "save" && method === "POST") {
        const { email, event } = await request.json();
        if (!email || !event) {
          return Response.json({ error: "Missing email or event payload" }, { status: 400, headers: corsHeaders });
        }

        const userId = email.replace(/[^a-zA-Z0-9_\-]/g, "_");
        const existingData = await env.OWL_NOSQL.collection("events").find(userId);

        const eventList = (existingData && existingData.list) || [];
        // If event has id, update it, otherwise create new
        if (event.id) {
          const idx = eventList.findIndex(e => e.id === event.id);
          if (idx !== -1) eventList[idx] = event;
          else eventList.push(event);
        } else {
          event.id = "evt_" + Math.random().toString(36).substring(2, 11);
          eventList.push(event);
        }

        await env.OWL_NOSQL.collection("events").insert(userId, { list: eventList });
        return Response.json({ success: true, event, events: eventList }, { headers: corsHeaders });
      }

      // ─── EVENTS DELETE ROUTE ─────────────────────────────────────────────────
      if (path === "/api/events" && url.searchParams.get("action") === "delete" && method === "POST") {
        const { email, eventId } = await request.json();
        if (!email || !eventId) {
          return Response.json({ error: "Missing email or eventId" }, { status: 400, headers: corsHeaders });
        }

        const userId = email.replace(/[^a-zA-Z0-9_\-]/g, "_");
        const existingData = await env.OWL_NOSQL.collection("events").find(userId);
        let eventList = (existingData && existingData.list) || [];
        eventList = eventList.filter(e => e.id !== eventId);

        await env.OWL_NOSQL.collection("events").insert(userId, { list: eventList });
        return Response.json({ success: true, events: eventList }, { headers: corsHeaders });
      }

      // ─── FILE UPLOAD ROUTE ───────────────────────────────────────────────────
      if (path === "/api/upload" && method === "POST") {
        const formData = await request.formData();
        const file = formData.get("file");
        if (!file) {
          return Response.json({ error: "No file provided" }, { status: 400, headers: corsHeaders });
        }

        const fileBuffer = await file.arrayBuffer();
        const cleanName = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._\-]/g, "_")}`;
        const contentType = file.type || "application/octet-stream";

        // Upload to OWL_STORAGE R2 wrapper
        await env.OWL_STORAGE.put(cleanName, fileBuffer, { contentType });
        const cdnUrl = `/_cdn/storage/${cleanName}`;

        const email = formData.get("email") || url.searchParams.get("email");
        if (email) {
          const userId = email.replace(/[^a-zA-Z0-9_\-]/g, "_");
          const user = await env.OWL_NOSQL.collection("users").find(userId);
          if (user) {
            user.photo = cdnUrl;
            await env.OWL_NOSQL.collection("users").insert(userId, user);
          }
        }

        return Response.json({
          success: true,
          fileName: cleanName,
          url: cdnUrl
        }, { headers: corsHeaders });
      }

      // ─── STRIPE PREMIUM CHECKOUT ROUTE ───────────────────────────────────────
      if (path === "/api/premium" && method === "POST") {
        const { email } = await request.json();
        if (!email) {
          return Response.json({ error: "Email is required" }, { status: 400, headers: corsHeaders });
        }

        // Stripe API calls
        const stripeRes = await env.STRIPE.paymentIntents.create({
          amount: 1999, // $19.99 for premium calendar features
          currency: "usd",
          receipt_email: email,
          metadata: { email, product: "premium_calendar_yearly" }
        });

        return Response.json({
          success: true,
          clientSecret: stripeRes.client_secret,
          amount: stripeRes.amount
        }, { headers: corsHeaders });
      }

      // Catch-all
      return Response.json({ error: "Not Found" }, { status: 404, headers: corsHeaders });

    } catch (e) {
      // 2. DEPLOYOWL exception tracking capture
      try {
        env.DEPLOYOWL.capture(e);
      } catch (telemetryErr) {
        console.warn("DeployOwl capture failed:", telemetryErr.message);
      }

      console.error("[api-error] Fatal exception caught:", e.stack || e.message);
      return Response.json({
        error: "Internal Server Error",
        details: e.message
      }, {
        status: 500,
        headers: corsHeaders
      });
    }
  }
};