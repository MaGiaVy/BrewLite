import json
import os

collection = {
    "info": {
        "_postman_id": "c8f7e6d5-c4b3-4a21-9876-543210abcdef",
        "name": "BrewLite API Performance & Verification Suite (< 500ms)",
        "description": "Bộ kiểm thử hiệu năng toàn diện cho hệ thống BrewLite theo chuẩn đề bài môn Công nghệ Phần mềm (ThS. Từ Lãng Phiêu) - Mục 4.2: Thời gian phản hồi API < 500ms với dữ liệu mẫu.",
        "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
    },
    "item": []
}

def create_item(name, method, url_path, description, headers=None, body=None, pre_script=None, post_script=None):
    hdrs = []
    if headers:
        for k, v in headers.items():
            hdrs.append({"key": k, "value": v, "type": "text"})
    
    req = {
        "method": method,
        "header": hdrs,
        "url": {
            "raw": "{{baseUrl}}" + url_path,
            "host": ["{{baseUrl}}"],
            "path": [p for p in url_path.strip("/").split("/") if p]
        },
        "description": description
    }
    
    if body:
        req["body"] = {
            "mode": "raw",
            "raw": json.dumps(body, indent=2, ensure_ascii=False),
            "options": {"raw": {"language": "json"}}
        }
    
    events = []
    if pre_script:
        events.append({
            "listen": "prerequest",
            "script": {"type": "text/javascript", "exec": pre_script.strip().splitlines()}
        })
    
    default_post = """pm.test("Status code hợp lệ (200, 201)", function () {
    pm.expect(pm.response.code).to.be.oneOf([200, 201]);
});

pm.test("Thời gian phản hồi đạt chuẩn yêu cầu phi chức năng (< 500ms)", function () {
    var maxTime = Number(pm.environment.get("max_response_time_ms")) || 500;
    pm.expect(pm.response.responseTime).to.be.below(maxTime);
});
"""
    if post_script:
        combined_post = default_post + "\n" + post_script.strip()
    else:
        combined_post = default_post
        
    events.append({
        "listen": "test",
        "script": {"type": "text/javascript", "exec": combined_post.strip().splitlines()}
    })
    
    return {
        "name": name,
        "event": events,
        "request": req,
        "response": []
    }

# Group 1: Hệ thống & Kiểm tra Sức khỏe
group1 = {
    "name": "01. Hệ Thống & Kiểm Tra Sức Khỏe",
    "item": [
        create_item(
            "EP01 - GET / (API Gateway Hello & Health)",
            "GET", "/",
            "Kiểm tra endpoint gốc và trạng thái sẵn sàng của API Gateway."
        )
    ]
}

# Group 2: Xác thực & Người dùng (Authentication)
group2 = {
    "name": "02. Xác Thực & Người Dùng (Auth)",
    "item": [
        create_item(
            "EP02 - POST /auth/login (Customer)",
            "POST", "/auth/login",
            "Đăng nhập tài khoản Khách hàng (khach@brewlite.vn), tự động lưu customer_token.",
            headers={"Content-Type": "application/json"},
            body={"email": "{{customer_email}}", "password": "{{customer_password}}"},
            post_script="""var jsonData = pm.response.json();
var token = jsonData.accessToken || jsonData.access_token || jsonData.token;
if (token) {
    pm.environment.set("customer_token", token);
    pm.test("Tự động trích xuất customer_token thành công", function() { pm.expect(token).to.be.a('string'); });
}"""
        ),
        create_item(
            "EP03 - POST /auth/login (Admin / Staff)",
            "POST", "/auth/login",
            "Đăng nhập tài khoản Quản trị viên / Barista (admin@brewlite.vn), tự động lưu admin_token.",
            headers={"Content-Type": "application/json"},
            body={"email": "{{admin_email}}", "password": "{{admin_password}}"},
            post_script="""var jsonData = pm.response.json();
var token = jsonData.accessToken || jsonData.access_token || jsonData.token;
if (token) {
    pm.environment.set("admin_token", token);
    pm.test("Tự động trích xuất admin_token thành công", function() { pm.expect(token).to.be.a('string'); });
}"""
        ),
        create_item(
            "EP04 - GET /auth/me (Thông tin tài khoản)",
            "GET", "/auth/me",
            "Lấy thông tin tài khoản đang đăng nhập kèm điểm thưởng loyaltyPoints và role.",
            headers={"Authorization": "Bearer {{customer_token}}"}
        )
    ]
}

# Group 3: Menu & Sản phẩm (Products)
group3 = {
    "name": "03. Danh Mục Thực Đơn & Sản Phẩm (Products)",
    "item": [
        create_item(
            "EP05 - GET /products (Danh sách Menu)",
            "GET", "/products",
            "Lấy toàn bộ danh sách sản phẩm hiển thị trên trang chủ và menu (Task 2 & 3).",
            post_script="""var products = pm.response.json();
if (Array.isArray(products) && products.length > 0) {
    pm.environment.set("productId", products[0].id);
}"""
        ),
        create_item(
            "EP06 - GET /products/:id (Chi tiết món)",
            "GET", "/products/{{productId}}",
            "Lấy chi tiết một đồ uống kèm thông tin kích cỡ và topping tùy chọn (Task 4)."
        )
    ]
}

# Group 4: Đơn hàng (Orders)
group4 = {
    "name": "04. Quản Lý Đơn Hàng (Orders)",
    "item": [
        create_item(
            "EP07 - POST /orders (Tạo đơn hàng mới)",
            "POST", "/orders",
            "Tạo đơn hàng từ giỏ hàng (Task 6), trừ kho nguyên liệu bằng Optimistic Locking, tự lưu orderId.",
            headers={"Authorization": "Bearer {{customer_token}}", "Content-Type": "application/json"},
            body={
                "items": [
                    {
                        "productId": 1,
                        "productName": "Cà phê Đen",
                        "size": "M",
                        "toppings": [],
                        "quantity": 1,
                        "unitPrice": 29000
                    }
                ]
            },
            post_script="""var newOrder = pm.response.json();
var oId = newOrder ? (newOrder.orderId || newOrder.id) : null;
if (oId) {
    pm.environment.set("orderId", oId);
    pm.test("Tự động lưu orderId thành công: #" + oId, function() {
        pm.expect(oId).to.be.above(0);
    });
}"""
        ),
        create_item(
            "EP08 - GET /orders/me (Lịch sử đơn của khách)",
            "GET", "/orders/me",
            "Lấy danh sách các đơn hàng đã đặt của khách hàng đang đăng nhập (Task 9).",
            headers={"Authorization": "Bearer {{customer_token}}"}
        ),
        create_item(
            "EP09 - GET /orders/:id (Chi tiết đơn hàng)",
            "GET", "/orders/{{orderId}}",
            "Lấy thông tin chi tiết của đơn hàng vừa tạo để hiển thị màn hình xác nhận đơn.",
            headers={"Authorization": "Bearer {{customer_token}}"}
        )
    ]
}

# Group 5: Thanh toán không tiền mặt (Payments)
group5 = {
    "name": "05. Thanh Toán Không Tiền Mặt (Payments)",
    "item": [
        create_item(
            "EP10 - POST /payments (Thanh toán Mock Payment)",
            "POST", "/payments",
            "Thanh toán đơn hàng vừa tạo (Task 8 & 10) với Idempotency-Key chống trùng lặp.",
            headers={
                "Authorization": "Bearer {{customer_token}}",
                "Content-Type": "application/json",
                "idempotency-key": "{{idempotencyKey}}"
            },
            body={
                "orderId": 1,
                "method": "EWALLET",
                "simulateFailure": False
            },
            pre_script="""var orderId = pm.environment.get("orderId");
if (orderId) {
    var rawBody = pm.request.body.raw;
    var parsed = JSON.parse(rawBody);
    parsed.orderId = Number(orderId);
    pm.request.body.raw = JSON.stringify(parsed);
}
var randIdem = "idem-" + Date.now() + "-" + Math.floor(Math.random() * 100000);
pm.variables.set("idempotencyKey", randIdem);
""",
            post_script="""pm.test("Đơn hàng được thanh toán PAID thành công", function() {
    var res = pm.response.json();
    pm.expect(res.status).to.be.oneOf(['PAID', 'SUCCESS', 'SUCCESSFUL']);
});"""
        ),
        create_item(
            "EP11 - GET /payments/zalopay/status/:orderId (Kiểm tra trạng thái thanh toán)",
            "GET", "/payments/zalopay/status/{{orderId}}",
            "Truy vấn trạng thái giao dịch thanh toán của đơn hàng.",
            headers={"Authorization": "Bearer {{customer_token}}"}
        )
    ]
}

# Group 6: Vận hành, Tồn kho & Nhân viên (Operations & Staff)
group6 = {
    "name": "06. Vận Hành Barista, Tồn Kho & Nhân Sự (Operations)",
    "item": [
        create_item(
            "EP12 - GET /orders/barista/queue (Hàng đợi Barista KDS)",
            "GET", "/orders/barista/queue",
            "Màn hình bếp Barista hiển thị danh sách đơn cần pha chế (Dành cho STAFF/ADMIN).",
            headers={"Authorization": "Bearer {{admin_token}}"}
        ),
        create_item(
            "EP13 - PATCH /orders/:id/status (Barista cập nhật trạng thái)",
            "PATCH", "/orders/{{orderId}}/status",
            "Cập nhật tiến độ pha chế đơn hàng: PAID -> PREPARING (Order State Machine Task 10).",
            headers={"Authorization": "Bearer {{admin_token}}", "Content-Type": "application/json"},
            body={"status": "PREPARING"},
            post_script="""pm.test("Trạng thái đơn hàng chuyển sang PREPARING hợp lệ", function() {
    var res = pm.response.json();
    pm.expect(res.status).to.equal('PREPARING');
});"""
        ),
        create_item(
            "EP14 - GET /inventory/pricing-config (Bảng giá Size & Topping)",
            "GET", "/inventory/pricing-config",
            "Lấy cấu hình giá phụ thu Size (S/M/L) và danh sách Topping toàn hệ thống."
        ),
        create_item(
            "EP15 - GET /staff (Danh sách nhân viên cửa hàng)",
            "GET", "/staff",
            "Quản lý danh sách nhân sự cửa hàng (Quyền ADMIN).",
            headers={"Authorization": "Bearer {{admin_token}}"}
        )
    ]
}

collection["item"] = [group1, group2, group3, group4, group5, group6]

out_dir = r"D:\SWE\BrewLite_SWE\BrewLite_SWE\docs\evidence\postman"
os.makedirs(out_dir, exist_ok=True)
out_path = os.path.join(out_dir, "brewlite_api_collection.json")

with open(out_path, "w", encoding="utf-8") as f:
    json.dump(collection, f, indent=2, ensure_ascii=False)

total_eps = sum(len(g["item"]) for g in collection["item"])
print(f"Successfully generated Postman Collection with {total_eps} endpoints at: {out_path}")
