"""
Delivery & Smartphone Notification Parser
Transforms raw BLE/Android notifications into glanceable, high-contrast Tripper alert banners.
"""

from dataclasses import dataclass
from datetime import datetime
from typing import Optional, Dict, Any

@dataclass
class DeliveryAlert:
    id: str
    source: str  # "zomato", "swiggy", "zepto", "amazon", "call", "sms"
    title: str
    body: str
    pickup_or_drop: str  # "PICKUP", "DROP", "CALL", "INFO"
    order_id: Optional[str]
    timestamp: datetime
    badge_color: str  # Hex color for UI theme

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "source": self.source,
            "title": self.title,
            "body": self.body,
            "pickup_or_drop": self.pickup_or_drop,
            "order_id": self.order_id,
            "timestamp": self.timestamp.isoformat(),
            "badge_color": self.badge_color
        }

class DeliveryParser:
    SOURCE_CONFIG = {
        "zomato": {"badge": "#E23744", "name": "Zomato Delivery"},
        "swiggy": {"badge": "#FC8019", "name": "Swiggy Rider"},
        "zepto": {"badge": "#9C27B0", "name": "Zepto Express"},
        "amazon": {"badge": "#FF9900", "name": "Amazon Flex"},
        "call": {"badge": "#00E676", "name": "Incoming Call"},
        "sms": {"badge": "#29B6F6", "name": "SMS Alert"},
        "system": {"badge": "#78909C", "name": "System"}
    }

    @classmethod
    def parse_notification(cls, raw_title: str, raw_body: str, package_name: str = "") -> DeliveryAlert:
        import uuid
        alert_id = str(uuid.uuid4())[:8]
        pkg = package_name.lower()
        title_lower = raw_title.lower()
        body_lower = raw_body.lower()

        # Identify source platform
        if "zomato" in pkg or "zomato" in title_lower or "zomato" in body_lower:
            source = "zomato"
        elif "swiggy" in pkg or "swiggy" in title_lower or "swiggy" in body_lower:
            source = "swiggy"
        elif "zepto" in pkg or "zepto" in title_lower:
            source = "zepto"
        elif "amazon" in pkg or "flex" in title_lower:
            source = "amazon"
        elif "call" in title_lower or "calling" in body_lower or "dialer" in pkg:
            source = "call"
        else:
            source = "sms" if "sms" in pkg or "message" in pkg else "system"

        # Determine type
        if "pickup" in body_lower or "pick up" in body_lower:
            ptype = "PICKUP"
        elif "drop" in body_lower or "deliver to" in body_lower:
            ptype = "DROP"
        elif source == "call":
            ptype = "CALL"
        else:
            ptype = "INFO"

        # Extract order ID if present
        order_id = None
        for word in raw_body.split():
            if word.startswith("#") and len(word) > 2:
                order_id = word.strip("#,.;:")
                break

        cfg = cls.SOURCE_CONFIG.get(source, cls.SOURCE_CONFIG["system"])
        return DeliveryAlert(
            id=alert_id,
            source=source,
            title=raw_title,
            body=raw_body,
            pickup_or_drop=ptype,
            order_id=order_id,
            timestamp=datetime.now(),
            badge_color=cfg["badge"]
        )
