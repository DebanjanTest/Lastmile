import json
import unittest
import urllib.request
import sqlite3
import uuid
from pathlib import Path

class TestRazorpayAndAuth(unittest.TestCase):
    BASE_URL = "http://localhost:8000"
    server_thread = None

    @classmethod
    def setUpClass(cls):
        # Verify if an existing server is running on port 8000
        server_running = False
        try:
            with urllib.request.urlopen(f"{cls.BASE_URL}/api/telemetry", timeout=1) as resp:
                if resp.status == 200:
                    server_running = True
        except Exception:
            pass

        if not server_running:
            import time
            import threading
            import uvicorn
            from core.engine import LastMileEngine
            from ui.server import create_app

            config_path = Path(__file__).resolve().parent.parent / "config.json"
            cfg = {}
            if config_path.exists():
                try:
                    cfg = json.loads(config_path.read_text(encoding="utf-8"))
                except Exception:
                    pass
            engine = LastMileEngine(cfg)
            app = create_app(engine)
            cls.server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=8000, log_level="error"))
            cls.server_thread = threading.Thread(target=cls.server.run, daemon=True)
            cls.server_thread.start()

            for _ in range(40):
                try:
                    with urllib.request.urlopen(f"{cls.BASE_URL}/api/telemetry", timeout=0.5) as resp:
                        if resp.status == 200:
                            break
                except Exception:
                    time.sleep(0.1)

    @classmethod
    def tearDownClass(cls):
        if cls.server_thread and hasattr(cls, 'server'):
            cls.server.should_exit = True

    def get_json(self, path):
        req = urllib.request.Request(f"{self.BASE_URL}{path}")
        with urllib.request.urlopen(req) as resp:
            self.assertEqual(resp.status, 200)
            return json.loads(resp.read().decode('utf-8'))

    def post_json(self, path, data):
        payload = json.dumps(data).encode('utf-8')
        req = urllib.request.Request(
            f"{self.BASE_URL}{path}",
            data=payload,
            headers={'Content-Type': 'application/json'}
        )
        with urllib.request.urlopen(req) as resp:
            self.assertEqual(resp.status, 200)
            return json.loads(resp.read().decode('utf-8'))

    def test_01_config_json_structure(self):
        config_path = Path(__file__).resolve().parent.parent / "config.json"
        with open(config_path, "r", encoding="utf-8") as f:
            cfg = json.load(f)
        
        self.assertIn("razorpay", cfg)
        self.assertTrue(cfg["razorpay"]["is_test_mode"])
        self.assertTrue(cfg["razorpay"]["key_id"].startswith("rzp_test_"))
        self.assertIn("merchant_vpa", cfg["razorpay"])

        self.assertIn("firebase", cfg)
        self.assertTrue(cfg["firebase"]["enabled"])
        self.assertIn("apiKey", cfg["firebase"])
        self.assertIn("mock_account", cfg["firebase"])

    def test_02_auth_config_endpoint(self):
        data = self.get_json("/api/auth/config")
        self.assertIn("apiKey", data)
        self.assertIn("authDomain", data)
        self.assertIn("projectId", data)
        self.assertIn("mock_account", data)
        self.assertEqual(data["mock_account"]["email"], "debanjan.rider@lastmile.io")

    def test_03_firebase_verify_endpoint(self):
        verify_payload = {
            "id_token": "mock_google_id_token",
            "user_info": {
                "uid": "google_test_rider_debanjan",
                "displayName": "Debanjan Mondal",
                "email": "debanjan.rider@lastmile.io",
                "photoURL": "https://lh3.googleusercontent.com/a/test-avatar"
            }
        }
        res = self.post_json("/api/auth/firebase-verify", verify_payload)
        self.assertEqual(res["status"], "Verified")
        self.assertEqual(res["claims"]["email"], "debanjan.rider@lastmile.io")
        self.assertEqual(res["claims"]["name"], "Debanjan Mondal")

    def test_04_rider_profile_persistence(self):
        update_data = {
            "id": "RIDER-KOL-01",
            "name": "Debanjan Mondal",
            "email": "debanjan.rider@lastmile.io",
            "phone": "+91 98765 43210",
            "vehicle_no": "WB 02 AB 4591",
            "daily_target_inr": 850.0,
            "daily_target_orders": 9,
            "photo_url": "https://lh3.googleusercontent.com/a/test-avatar"
        }
        post_res = self.post_json("/api/rider/profile", update_data)
        self.assertEqual(post_res["status"], "Profile updated")

        get_res = self.get_json("/api/rider/profile")
        self.assertEqual(get_res["daily_target_inr"], 850.0)
        self.assertEqual(get_res["name"], "Debanjan Mondal")

    def test_05_razorpay_test_qr_generation(self):
        req_data = {
            "order_id": "ORD-LIVE-COD-77",
            "amount_inr": 420.50
        }
        res = self.post_json("/api/payment/razorpay-qr", req_data)
        self.assertTrue(res["qr_id"].startswith("qr_rzp_test_"))
        self.assertEqual(res["order_id"], "ORD-LIVE-COD-77")
        self.assertEqual(res["amount_inr"], 420.50)
        self.assertTrue(res["is_test_mode"])
        self.assertIn("api.qrserver.com", res["image_url"])
        self.assertIn("rzp_test_", res["key_id"])

    def test_06_razorpay_instant_verify_and_status(self):
        qr_res = self.post_json("/api/payment/razorpay-qr", {
            "order_id": "ORD-INSTANT-01",
            "amount_inr": 310.0
        })
        qr_id = qr_res["qr_id"]

        # Instant payment verification
        verify_res = self.post_json("/api/payment/verify-instant", {
            "qr_id": qr_id,
            "order_id": "ORD-INSTANT-01",
            "amount_inr": 310.0
        })
        self.assertEqual(verify_res["status"], "SUCCESS")
        self.assertTrue(verify_res["payment_id"].startswith("pay_rzp_instant_"))

        # Verify status endpoint reflects payment
        status_res = self.get_json(f"/api/payment/status/{qr_id}")
        self.assertEqual(status_res["status"], "PAID")

    def test_07_full_delivery_handover_with_sqlite_ledger(self):
        test_order_id = f"ORD-TEST-RZP-{uuid.uuid4().hex[:6].upper()}"
        # 1. Infiltrate customer order
        infiltrate_res = self.post_json("/api/feed/infiltrate", {
            "order_data": {
                "order_id": test_order_id,
                "platform": "swiggy",
                "store_name": "Arsalan Park Circus",
                "customer_name": "Debanjan Mondal",
                "payout_inr": 95.0,
                "payment_mode": "COD",
                "cod_amount": 540.0,
                "delivery_otp": "6190"
            }
        })
        self.assertEqual(infiltrate_res["status"], "Infiltrated")

        # 2. Accept order -> Reach Store -> Pickup -> Reach Customer
        accept_res = self.post_json("/api/feed/accept", {"order_id": test_order_id})
        self.assertEqual(accept_res["status"], "Accepted")
        self.post_json("/api/feed/reach-store", {})
        self.post_json("/api/feed/pickup", {})
        self.post_json("/api/feed/reach-customer", {})

        # 3. Generate Razorpay QR for handover
        qr_res = self.post_json("/api/payment/razorpay-qr", {
            "order_id": test_order_id,
            "amount_inr": 540.0
        })
        self.assertEqual(qr_res["amount_inr"], 540.0)

        # 4. Confirm Payment
        self.post_json("/api/payment/verify-instant", {
            "qr_id": qr_res["qr_id"],
            "order_id": test_order_id,
            "amount_inr": 540.0
        })

        # 5. Finalize Delivery
        deliver_res = self.post_json("/api/feed/deliver", {})
        self.assertIsNotNone(deliver_res["result"])

        # 6. Verify SQLite completed_orders record
        db_path = Path(__file__).resolve().parent.parent / "data" / "lastmile.db"
        self.assertTrue(db_path.exists())
        with sqlite3.connect(db_path) as conn:
            cur = conn.cursor()
            cur.execute("SELECT order_id, platform, status, payout_inr FROM completed_orders WHERE order_id = ?", (test_order_id,))
            row = cur.fetchone()
            self.assertIsNotNone(row)
            self.assertEqual(row[0], test_order_id)
            self.assertEqual(row[1], "swiggy")
            self.assertEqual(row[2], "DELIVERED")
            self.assertEqual(row[3], 95.0)

if __name__ == "__main__":
    unittest.main()
