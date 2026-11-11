"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";

export interface CustomerUser {
  id: number;
  email: string;
  fullName: string;
  phone?: string | null;
  isActive: boolean;
  loyaltyPoints: number;
  createdAt: string;
  _count?: {
    orders: number;
  };
}

interface Props {
  customers?: CustomerUser[];
  staffList?: any[];
  currentUserId?: number;
  onRefresh?: () => Promise<void> | void;
  showToast: (msg: string) => void;
  apiFetch: (endpoint: string, options?: RequestInit) => Promise<Response>;
}

export default function CustomerManagementSection({
  customers: initialCustomers,
  onRefresh,
  showToast,
  apiFetch,
}: Props) {
  const [customerList, setCustomerList] = useState<CustomerUser[]>(
    initialCustomers || []
  );
  const [isLoading, setIsLoading] = useState<boolean>(false);

  // Search & Filter State
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | "ACTIVE" | "INACTIVE">("ALL");
  const [sortBy, setSortBy] = useState<"NEWEST" | "POINTS" | "ORDERS" | "NAME">("NEWEST");

  // Create Modal State
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [createFullName, setCreateFullName] = useState("");
  const [createEmail, setCreateEmail] = useState("");
  const [createPhone, setCreatePhone] = useState("");
  const [createPassword, setCreatePassword] = useState("123456");
  const [isSubmittingCreate, setIsSubmittingCreate] = useState(false);

  // Edit Modal State
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<CustomerUser | null>(null);
  const [editFullName, setEditFullName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editIsActive, setEditIsActive] = useState(true);
  const [editNewPassword, setEditNewPassword] = useState("");
  const [isSubmittingEdit, setIsSubmittingEdit] = useState(false);

  // Smart Delete Confirmation Modal State
  const [deletingCustomer, setDeletingCustomer] = useState<CustomerUser | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Fetch customers from backend
  const fetchCustomers = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await apiFetch("/admin/customers", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setCustomerList(Array.isArray(data) ? data : []);
      } else {
        const err = await res.json().catch(() => ({}));
        showToast(err.message || "Không thể tải danh sách khách hàng");
      }
    } catch {
      showToast("Lỗi kết nối khi tải danh sách khách hàng");
    } finally {
      setIsLoading(false);
    }
  }, [apiFetch, showToast]);

  useEffect(() => {
    fetchCustomers();
  }, [fetchCustomers]);

  // Đồng bộ khi prop customers thay đổi
  useEffect(() => {
    if (initialCustomers && initialCustomers.length > 0) {
      setCustomerList(initialCustomers);
    }
  }, [initialCustomers]);

  // Handle global refresh
  const handleReload = async () => {
    await fetchCustomers();
    if (onRefresh) {
      await onRefresh();
    }
  };

  // Avatar chữ cái
  const getInitials = (name: string) => {
    if (!name) return "KH";
    const parts = name.trim().split(" ");
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  };

  // Summary Metrics
  const totalCustomers = customerList.length;
  const activeCount = customerList.filter((c) => c.isActive).length;
  const inactiveCount = customerList.filter((c) => !c.isActive).length;
  const totalLoyaltyPoints = customerList.reduce(
    (sum, c) => sum + (c.loyaltyPoints || 0),
    0
  );

  // Filtered & Sorted Customer List
  const filteredCustomers = useMemo(() => {
    return customerList
      .filter((c) => {
        const q = searchQuery.toLowerCase().trim();
        const matchQuery =
          !q ||
          c.fullName?.toLowerCase().includes(q) ||
          c.email?.toLowerCase().includes(q) ||
          c.phone?.includes(q) ||
          `kh${c.id}`.includes(q);

        const matchStatus =
          statusFilter === "ALL" ||
          (statusFilter === "ACTIVE" && c.isActive) ||
          (statusFilter === "INACTIVE" && !c.isActive);

        return matchQuery && matchStatus;
      })
      .sort((a, b) => {
        if (sortBy === "POINTS") {
          return (b.loyaltyPoints || 0) - (a.loyaltyPoints || 0);
        }
        if (sortBy === "ORDERS") {
          return (b._count?.orders || 0) - (a._count?.orders || 0);
        }
        if (sortBy === "NAME") {
          return (a.fullName || "").localeCompare(b.fullName || "");
        }
        // Default NEWEST (id desc)
        return b.id - a.id;
      });
  }, [customerList, searchQuery, statusFilter, sortBy]);

  // ─── HANDLERS ─────────────────────────────────────────────────────────────

  // Toggle Khóa / Mở Khóa Nhanh
  const handleToggleStatus = async (customer: CustomerUser) => {
    const nextStatus = !customer.isActive;
    try {
      const res = await apiFetch(`/admin/customers/${customer.id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: nextStatus }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || "Không thể cập nhật trạng thái khách hàng");
      }

      showToast(
        nextStatus
          ? `🔓 Đã kích hoạt tài khoản: ${customer.fullName}`
          : `🔒 Đã tạm khóa tài khoản: ${customer.fullName}`
      );
      await handleReload();
    } catch (err: any) {
      showToast(`❌ ${err.message || "Lỗi cập nhật trạng thái"}`);
    }
  };

  // Mở Modal Thêm Mới
  const handleOpenCreateModal = () => {
    setCreateFullName("");
    setCreateEmail("");
    setCreatePhone("");
    setCreatePassword("123456");
    setIsCreateModalOpen(true);
  };

  // Submit Tạo Khách Hàng Thủ Công (RÀNG BUỘC SỐNG CÒN: Không có trường loyaltyPoints)
  const handleCreateCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createFullName.trim()) {
      showToast("Vui lòng nhập họ và tên khách hàng");
      return;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!createEmail.trim() || !emailRegex.test(createEmail.trim())) {
      showToast("Vui lòng nhập địa chỉ email hợp lệ (ví dụ: customer@brewlite.vn)");
      return;
    }
    const phoneRegex = /^(0[3|5|7|8|9])[0-9]{8}$/;
    if (createPhone.trim() && !phoneRegex.test(createPhone.trim())) {
      showToast("Số điện thoại không hợp lệ (cần 10 số, bắt đầu bằng 03, 05, 07, 08, 09)");
      return;
    }

    setIsSubmittingCreate(true);
    try {
      const payload = {
        fullName: createFullName.trim(),
        email: createEmail.trim().toLowerCase(),
        phone: createPhone.trim() || undefined,
        password: createPassword.trim() || "123456",
      };

      const res = await apiFetch("/admin/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || "Không thể tạo tài khoản khách hàng");
      }

      showToast(`✅ Đã tạo thành công khách hàng: ${createFullName.trim()}`);
      setIsCreateModalOpen(false);
      await handleReload();
    } catch (err: any) {
      showToast(`❌ ${err.message || "Lỗi tạo khách hàng"}`);
    } finally {
      setIsSubmittingCreate(false);
    }
  };

  // Mở Modal Chỉnh Sửa
  const handleOpenEditModal = (customer: CustomerUser) => {
    setEditingCustomer(customer);
    setEditFullName(customer.fullName || "");
    setEditPhone(customer.phone || "");
    setEditIsActive(customer.isActive);
    setEditNewPassword("");
    setIsEditModalOpen(true);
  };

  // Submit Chỉnh Sửa Khách Hàng (RÀNG BUỘC SỐNG CÒN: Không gửi loyaltyPoints)
  const handleUpdateCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCustomer) return;

    if (!editFullName.trim()) {
      showToast("Vui lòng nhập họ và tên khách hàng");
      return;
    }
    const phoneRegex = /^(0[3|5|7|8|9])[0-9]{8}$/;
    if (editPhone.trim() && !phoneRegex.test(editPhone.trim())) {
      showToast("Số điện thoại không hợp lệ (cần 10 số, bắt đầu bằng 03, 05, 07, 08, 09)");
      return;
    }

    setIsSubmittingEdit(true);
    try {
      const payload: {
        fullName: string;
        phone: string | null;
        isActive: boolean;
        password?: string;
      } = {
        fullName: editFullName.trim(),
        phone: editPhone.trim() || null,
        isActive: editIsActive,
      };

      if (editNewPassword.trim()) {
        payload.password = editNewPassword.trim();
      }

      const res = await apiFetch(`/admin/customers/${editingCustomer.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || "Không thể cập nhật khách hàng");
      }

      showToast(`✅ Đã cập nhật khách hàng: ${editFullName.trim()}`);
      setIsEditModalOpen(false);
      await handleReload();
    } catch (err: any) {
      showToast(`❌ ${err.message || "Lỗi cập nhật khách hàng"}`);
    } finally {
      setIsSubmittingEdit(false);
    }
  };

  // Submit Xóa Thông Minh (Smart Delete)
  const handleConfirmDelete = async () => {
    if (!deletingCustomer) return;
    setIsDeleting(true);
    try {
      const res = await apiFetch(`/admin/customers/${deletingCustomer.id}`, {
        method: "DELETE",
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.message || "Không thể xóa khách hàng");
      }

      showToast(
        data.message ||
          `Đã xử lý xóa tài khoản khách hàng ${deletingCustomer.fullName}`
      );
      setDeletingCustomer(null);
      await handleReload();
    } catch (err: any) {
      showToast(`❌ ${err.message || "Lỗi xóa khách hàng"}`);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* 4 Cards Thống Kê Nhanh (Bento Grid) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Tổng khách hàng */}
        <div className="bg-white rounded-2xl p-5 border border-[#E6DDD5] shadow-xs flex items-center justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-[#7A6A5E]">
              Tổng Khách Hàng
            </p>
            <p className="text-2xl font-extrabold text-[#2C1E18] mt-1 font-headline">
              {totalCustomers.toLocaleString("vi-VN")}
            </p>
            <p className="text-[11px] text-[#7A6A5E] mt-0.5">
              Tài khoản thành viên đăng ký
            </p>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-[#F3ECE4] text-[#9E5A2B] flex items-center justify-center">
            <span className="material-symbols-outlined text-[26px]">group</span>
          </div>
        </div>

        {/* Card 2: Đang hoạt động */}
        <div className="bg-white rounded-2xl p-5 border border-[#E6DDD5] shadow-xs flex items-center justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-[#7A6A5E]">
              Đang Hoạt Động
            </p>
            <p className="text-2xl font-extrabold text-[#166534] mt-1 font-headline">
              {activeCount.toLocaleString("vi-VN")}
            </p>
            <p className="text-[11px] text-emerald-600 font-medium mt-0.5">
              Khả dụng đặt hàng & tích điểm
            </p>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-emerald-100 text-[#166534] flex items-center justify-center">
            <span className="material-symbols-outlined text-[26px]">
              check_circle
            </span>
          </div>
        </div>

        {/* Card 3: Tạm khóa */}
        <div className="bg-white rounded-2xl p-5 border border-[#E6DDD5] shadow-xs flex items-center justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-[#7A6A5E]">
              Đã Tạm Khóa
            </p>
            <p className="text-2xl font-extrabold text-[#991B1B] mt-1 font-headline">
              {inactiveCount.toLocaleString("vi-VN")}
            </p>
            <p className="text-[11px] text-[#991B1B] font-medium mt-0.5">
              Khóa đăng nhập hoặc bảo toàn dữ liệu
            </p>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-red-100 text-[#991B1B] flex items-center justify-center">
            <span className="material-symbols-outlined text-[26px]">lock</span>
          </div>
        </div>

        {/* Card 4: Tổng Hạt Vàng Tích Lũy */}
        <div className="bg-gradient-to-br from-[#FFF8F0] to-[#FEF3C7] rounded-2xl p-5 border border-amber-200/80 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-amber-900">
              Tổng Điểm Hạt Vàng
            </p>
            <p className="text-2xl font-extrabold text-[#9E5A2B] mt-1 font-headline">
              {totalLoyaltyPoints.toLocaleString("vi-VN")}
            </p>
            <p className="text-[11px] text-amber-800 font-semibold mt-0.5">
              Quản lý hoàn toàn tự động qua BOM/Đơn
            </p>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-amber-400 to-amber-600 text-white flex items-center justify-center shadow-xs">
            <span className="material-symbols-outlined text-[26px]">stars</span>
          </div>
        </div>
      </div>

      {/* Action Bar & Filter Container */}
      <div className="bg-white rounded-2xl border border-[#E6DDD5] shadow-xs p-5">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-amber-600" />
              <h2 className="font-headline text-lg font-extrabold text-[#2C1E18]">
                ☕ Quản Lý Khách Hàng &amp; Thành Viên Thân Thiết
              </h2>
            </div>
            <p className="text-xs text-[#7A6A5E] mt-0.5">
              Tra cứu hồ sơ khách hàng, giám sát Điểm Hạt Vàng (chỉ đọc), kích hoạt/tạm khóa và xóa bảo toàn lịch sử
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleReload}
              disabled={isLoading}
              className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-[#FAF6F0] hover:bg-[#E6DDD5] text-xs font-bold text-[#2C1E18] transition-colors cursor-pointer border border-[#E6DDD5]"
              title="Làm mới danh sách"
            >
              <span
                className={`material-symbols-outlined text-[16px] ${
                  isLoading ? "animate-spin" : ""
                }`}
              >
                refresh
              </span>
              <span>Làm mới</span>
            </button>

            <button
              type="button"
              onClick={handleOpenCreateModal}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#2C1810] hover:bg-[#3F2E26] text-white text-xs font-bold transition-all shadow-sm cursor-pointer"
            >
              <span className="material-symbols-outlined text-[18px]">
                person_add
              </span>
              <span>Thêm Khách Hàng Mới</span>
            </button>
          </div>
        </div>

        {/* Filter & Search Bar */}
        <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 mt-4 pt-4 border-t border-[#F0EAE3]">
          {/* Ô Tìm Kiếm */}
          <div className="sm:col-span-5 relative">
            <span className="material-symbols-outlined absolute left-3 top-2.5 text-[#A8988B] text-lg">
              search
            </span>
            <input
              type="text"
              placeholder="Tìm theo tên, email, SĐT, mã KH (#KH...)"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 rounded-xl bg-[#FAF6F0] border border-[#E6DDD5] text-xs text-[#2C1E18] focus:outline-none focus:border-[#9E5A2B]"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-2.5 top-2.5 text-[#A8988B] hover:text-[#2C1E18]"
              >
                <span className="material-symbols-outlined text-sm">close</span>
              </button>
            )}
          </div>

          {/* Lọc Trạng Thái */}
          <div className="sm:col-span-4 flex items-center gap-2">
            <label className="text-xs text-[#7A6A5E] font-medium shrink-0">
              Trạng thái:
            </label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
              className="w-full px-3 py-2 rounded-xl bg-[#FAF6F0] border border-[#E6DDD5] text-xs text-[#2C1E18] focus:outline-none focus:border-[#9E5A2B] font-semibold"
            >
              <option value="ALL">Tất cả ({customerList.length})</option>
              <option value="ACTIVE">Đang hoạt động ({activeCount})</option>
              <option value="INACTIVE">Đã tạm khóa ({inactiveCount})</option>
            </select>
          </div>

          {/* Sắp Xếp */}
          <div className="sm:col-span-3 flex items-center gap-2">
            <label className="text-xs text-[#7A6A5E] font-medium shrink-0">
              Xếp theo:
            </label>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="w-full px-3 py-2 rounded-xl bg-[#FAF6F0] border border-[#E6DDD5] text-xs text-[#2C1E18] focus:outline-none focus:border-[#9E5A2B] font-semibold"
            >
              <option value="NEWEST">Mới nhất (ID ↓)</option>
              <option value="POINTS">🌟 Điểm Hạt Vàng cao nhất</option>
              <option value="ORDERS">🛍️ Số đơn đặt nhiều nhất</option>
              <option value="NAME">Tên khách hàng (A-Z)</option>
            </select>
          </div>
        </div>
      </div>

      {/* Customer Table */}
      <div className="bg-white rounded-2xl border border-[#E6DDD5] shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-[#FAF6F0] border-b border-[#E6DDD5] text-[#7A6A5E] font-bold uppercase tracking-wider text-[11px]">
                <th className="py-3 px-4">Mã KH</th>
                <th className="py-3 px-4">Khách Hàng</th>
                <th className="py-3 px-4">Thông Tin Liên Hệ</th>
                <th className="py-3 px-4">
                  <div className="flex items-center gap-1">
                    <span>Điểm Hạt Vàng</span>
                    <span
                      className="material-symbols-outlined text-xs text-amber-600"
                      title="Chỉ đọc - Tích lũy tự động từ đơn hàng thành công"
                    >
                      help
                    </span>
                  </div>
                </th>
                <th className="py-3 px-4">Đơn Đã Đặt</th>
                <th className="py-3 px-4">Ngày Tham Gia</th>
                <th className="py-3 px-4">Trạng Thái</th>
                <th className="py-3 px-4 text-right">Thao Tác</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-[#F0EAE3]">
              {isLoading ? (
                Array.from({ length: 5 }).map((_, idx) => (
                  <tr key={idx} className="animate-pulse">
                    <td className="py-4 px-4">
                      <div className="h-4 bg-[#F3ECE4] rounded-md w-12" />
                    </td>
                    <td className="py-4 px-4">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-[#F3ECE4]" />
                        <div className="space-y-1.5">
                          <div className="h-3.5 bg-[#F3ECE4] rounded-md w-28" />
                          <div className="h-2.5 bg-[#F3ECE4] rounded-md w-16" />
                        </div>
                      </div>
                    </td>
                    <td className="py-4 px-4">
                      <div className="h-3 bg-[#F3ECE4] rounded-md w-36 mb-1" />
                      <div className="h-2.5 bg-[#F3ECE4] rounded-md w-24" />
                    </td>
                    <td className="py-4 px-4">
                      <div className="h-6 bg-[#FEF3C7] rounded-full w-24" />
                    </td>
                    <td className="py-4 px-4">
                      <div className="h-4 bg-[#F3ECE4] rounded-md w-16" />
                    </td>
                    <td className="py-4 px-4">
                      <div className="h-3 bg-[#F3ECE4] rounded-md w-20" />
                    </td>
                    <td className="py-4 px-4">
                      <div className="h-6 bg-[#F3ECE4] rounded-full w-20" />
                    </td>
                    <td className="py-4 px-4 text-right">
                      <div className="h-6 bg-[#F3ECE4] rounded-md w-16 ml-auto" />
                    </td>
                  </tr>
                ))
              ) : filteredCustomers.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-[#7A6A5E]">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <span className="material-symbols-outlined text-4xl text-[#C4B7AC]">
                        person_off
                      </span>
                      <p className="font-medium">
                        Không tìm thấy khách hàng nào phù hợp với bộ lọc
                      </p>
                      <button
                        type="button"
                        onClick={handleOpenCreateModal}
                        className="mt-2 px-3.5 py-1.5 rounded-lg bg-[#9E5A2B] text-white text-xs font-bold hover:bg-[#78350F] transition-colors cursor-pointer"
                      >
                        + Thêm khách hàng mới
                      </button>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredCustomers.map((customer) => {
                  const ordersCount = customer._count?.orders ?? 0;
                  const dateStr = customer.createdAt
                    ? new Date(customer.createdAt).toLocaleDateString("vi-VN")
                    : "—";

                  return (
                    <tr
                      key={customer.id}
                      className="hover:bg-[#FAF6F0]/60 transition-colors"
                    >
                      {/* Cột 1: Mã KH */}
                      <td className="py-3.5 px-4 font-mono font-bold text-[#7A6A5E]">
                        #KH{customer.id}
                      </td>

                      {/* Cột 2: Khách Hàng (Avatar + Tên) */}
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-full bg-[#2C1810] text-[#FEBC85] flex items-center justify-center font-bold text-xs shrink-0 shadow-xs border border-[#9E5A2B]/20">
                            {getInitials(customer.fullName)}
                          </div>
                          <div>
                            <p className="font-extrabold text-[#2C1E18]">
                              {customer.fullName}
                            </p>
                            <span className="text-[10px] text-[#7A6A5E]">
                              Thành viên BrewLite
                            </span>
                          </div>
                        </div>
                      </td>

                      {/* Cột 3: Liên Hệ */}
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-1 text-[#2C1E18] font-medium">
                          <span className="material-symbols-outlined text-[13px] text-[#A8988B]">
                            mail
                          </span>
                          <span>{customer.email}</span>
                        </div>
                        <div className="flex items-center gap-1 text-[11px] text-[#7A6A5E] mt-0.5">
                          <span className="material-symbols-outlined text-[13px] text-[#A8988B]">
                            call
                          </span>
                          <span>
                            {customer.phone || (
                              <em className="text-[#A8988B]">Chưa cập nhật SĐT</em>
                            )}
                          </span>
                        </div>
                      </td>

                      {/* Cột 4: Điểm Hạt Vàng (RÀNG BUỘC SỐNG CÒN: CHỈ ĐỌC / READ-ONLY) */}
                      <td className="py-3.5 px-4">
                        <div
                          className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-gradient-to-r from-amber-50 to-yellow-100/70 border border-amber-300 text-amber-900 font-extrabold text-xs shadow-xs"
                          title="Điểm Hạt Vàng: Chỉ đọc. Tự động tích lũy qua đơn hàng đã thanh toán."
                        >
                          <span className="material-symbols-outlined text-[15px] text-amber-600">
                            stars
                          </span>
                          <span>
                            {(customer.loyaltyPoints || 0).toLocaleString("vi-VN")}
                          </span>
                          <span className="text-[10px] text-amber-700/80 font-bold">
                            hạt
                          </span>
                        </div>
                      </td>

                      {/* Cột 5: Đơn Đã Đặt */}
                      <td className="py-3.5 px-4">
                        <span className="inline-flex items-center gap-1 font-bold text-[#2C1E18]">
                          <span className="material-symbols-outlined text-[14px] text-[#7A6A5E]">
                            receipt_long
                          </span>
                          <span>{ordersCount} đơn</span>
                        </span>
                      </td>

                      {/* Cột 6: Ngày Tham Gia */}
                      <td className="py-3.5 px-4 text-[#7A6A5E] font-medium">
                        {dateStr}
                      </td>

                      {/* Cột 7: Trạng Thái & Toggle nhanh */}
                      <td className="py-3.5 px-4">
                        <button
                          type="button"
                          onClick={() => handleToggleStatus(customer)}
                          title={
                            customer.isActive
                              ? "Bấm để Tạm Khóa tài khoản khách hàng"
                              : "Bấm để Kích Hoạt lại tài khoản khách hàng"
                          }
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold transition-all cursor-pointer ${
                            customer.isActive
                              ? "bg-emerald-100 text-emerald-800 hover:bg-emerald-200 border border-emerald-300"
                              : "bg-red-100 text-red-800 hover:bg-red-200 border border-red-300"
                          }`}
                        >
                          <span className="material-symbols-outlined text-[14px]">
                            {customer.isActive ? "check_circle" : "lock"}
                          </span>
                          <span>{customer.isActive ? "Hoạt động" : "Tạm khóa"}</span>
                        </button>
                      </td>

                      {/* Cột 8: Thao Tác (Sửa, Xóa) */}
                      <td className="py-3.5 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {/* Sửa thông tin */}
                          <button
                            type="button"
                            onClick={() => handleOpenEditModal(customer)}
                            className="p-1.5 rounded-lg bg-[#FAF0E6] hover:bg-[#F0E2D4] text-[#9E5A2B] hover:text-[#78350F] transition-colors cursor-pointer"
                            title="Chỉnh sửa thông tin khách hàng"
                          >
                            <span className="material-symbols-outlined text-[17px]">
                              edit
                            </span>
                          </button>

                          {/* Xóa tài khoản (Smart Delete) */}
                          <button
                            type="button"
                            onClick={() => setDeletingCustomer(customer)}
                            className="p-1.5 rounded-lg bg-red-50 hover:bg-red-100 text-red-600 hover:text-red-800 transition-colors cursor-pointer"
                            title="Xóa tài khoản khách hàng (Smart Delete)"
                          >
                            <span className="material-symbols-outlined text-[17px]">
                              delete
                            </span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Footer phân trang / đếm số lượng */}
        <div className="p-3 bg-[#FAF6F0] border-t border-[#E6DDD5] flex items-center justify-between text-xs text-[#7A6A5E]">
          <span>
            Hiển thị <strong>{filteredCustomers.length}</strong> /{" "}
            <strong>{customerList.length}</strong> khách hàng
          </span>
          <span className="italic text-[11px]">
            Hệ thống tự động đồng bộ điểm hạt vàng theo doanh số đơn hàng
          </span>
        </div>
      </div>

      {/* ===================================================================
          MODAL 1: THÊM KHÁCH HÀNG MỚI (THỦ CÔNG)
          RÀNG BUỘC SỐNG CÒN: TUYỆT ĐỐI KHÔNG CÓ Ô NHẬP ĐIỂM HẠT VÀNG
         =================================================================== */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-[#E6DDD5]">
            <div className="flex items-start justify-between gap-3 pb-3 border-b border-[#E6DDD5]">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-[#9E5A2B]">
                  Quản lý khách hàng
                </span>
                <h3 className="font-headline text-lg font-extrabold text-[#2C1E18]">
                  Thêm Khách Hàng Mới
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsCreateModalOpen(false)}
                className="w-8 h-8 rounded-full bg-[#F3ECE4] hover:bg-[#E6DDD5] flex items-center justify-center text-[#7A6A5E] transition-colors cursor-pointer"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            <form onSubmit={handleCreateCustomer} className="mt-4 space-y-3.5">
              {/* Banner Lưu ý Ràng Buộc Điểm */}
              <div className="p-3 bg-amber-50 rounded-xl border border-amber-200/80 flex items-start gap-2.5">
                <span className="material-symbols-outlined text-amber-600 text-lg shrink-0 mt-0.5">
                  stars
                </span>
                <div className="text-[11px] text-amber-900 leading-tight">
                  <p className="font-bold">Quy tắc Điểm Hạt Vàng:</p>
                  <p className="text-amber-800 mt-0.5">
                    Khách hàng mới được khởi tạo với <strong>0 Hạt Vàng</strong>. Điểm sẽ tự động tích lũy khi khách hoàn tất đơn hàng.
                  </p>
                </div>
              </div>

              {/* Họ và tên */}
              <div>
                <label className="block text-xs font-bold text-[#2C1E18] mb-1">
                  Họ và tên khách hàng *
                </label>
                <input
                  type="text"
                  required
                  value={createFullName}
                  onChange={(e) => setCreateFullName(e.target.value)}
                  placeholder="VD: Nguyễn Văn An"
                  className="w-full px-3.5 py-2 rounded-xl bg-[#FAF6F0] border border-[#E6DDD5] text-xs font-semibold focus:outline-none focus:border-[#9E5A2B]"
                />
              </div>

              {/* Email đăng nhập */}
              <div>
                <label className="block text-xs font-bold text-[#2C1E18] mb-1">
                  Địa chỉ Email đăng nhập *
                </label>
                <input
                  type="email"
                  required
                  value={createEmail}
                  onChange={(e) => setCreateEmail(e.target.value)}
                  placeholder="VD: an.nguyen@gmail.com"
                  className="w-full px-3.5 py-2 rounded-xl bg-[#FAF6F0] border border-[#E6DDD5] text-xs font-semibold focus:outline-none focus:border-[#9E5A2B]"
                />
              </div>

              {/* Số điện thoại */}
              <div>
                <label className="block text-xs font-bold text-[#2C1E18] mb-1">
                  Số điện thoại (tùy chọn)
                </label>
                <input
                  type="tel"
                  value={createPhone}
                  onChange={(e) => setCreatePhone(e.target.value)}
                  placeholder="VD: 0901234567"
                  className="w-full px-3.5 py-2 rounded-xl bg-[#FAF6F0] border border-[#E6DDD5] text-xs font-semibold focus:outline-none focus:border-[#9E5A2B]"
                />
              </div>

              {/* Mật khẩu khởi tạo */}
              <div>
                <label className="block text-xs font-bold text-[#2C1E18] mb-1">
                  Mật khẩu khởi tạo *
                </label>
                <input
                  type="text"
                  required
                  value={createPassword}
                  onChange={(e) => setCreatePassword(e.target.value)}
                  placeholder="Mặc định: 123456"
                  className="w-full px-3.5 py-2 rounded-xl bg-[#FAF6F0] border border-[#E6DDD5] text-xs font-mono font-bold focus:outline-none focus:border-[#9E5A2B]"
                />
                <p className="text-[10px] text-[#7A6A5E] mt-1">
                  Mặc định là <strong>123456</strong>. Khách hàng có thể tự đổi lại mật khẩu trong trang cá nhân sau khi đăng nhập.
                </p>
              </div>

              {/* Nút thao tác */}
              <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#E6DDD5]">
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                  className="px-4 py-2 rounded-xl bg-[#F3ECE4] hover:bg-[#E6DDD5] text-xs font-bold text-[#7A6A5E] transition-colors cursor-pointer"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingCreate}
                  className="px-5 py-2 rounded-xl bg-[#2C1810] hover:bg-[#3F2E26] text-white text-xs font-bold transition-all shadow-sm cursor-pointer disabled:opacity-50"
                >
                  {isSubmittingCreate ? "Đang tạo..." : "Tạo Khách Hàng"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ===================================================================
          MODAL 2: CHỈNH SỬA THÔNG TIN KHÁCH HÀNG
          RÀNG BUỘC SỐNG CÒN: ĐIỂM HẠT VÀNG CHỈ ĐỌC / KHÔNG CHO PHÉP NHẬP SỬA
         =================================================================== */}
      {isEditModalOpen && editingCustomer && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-[#E6DDD5]">
            <div className="flex items-start justify-between gap-3 pb-3 border-b border-[#E6DDD5]">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-[#9E5A2B]">
                  Hồ sơ khách hàng #KH{editingCustomer.id}
                </span>
                <h3 className="font-headline text-lg font-extrabold text-[#2C1E18]">
                  Chỉnh Sửa Thông Tin
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsEditModalOpen(false)}
                className="w-8 h-8 rounded-full bg-[#F3ECE4] hover:bg-[#E6DDD5] flex items-center justify-center text-[#7A6A5E] transition-colors cursor-pointer"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            <form onSubmit={handleUpdateCustomer} className="mt-4 space-y-3.5">
              {/* Badge Điểm Hạt Vàng Chỉ Đọc (Read-only banner) */}
              <div className="p-3 bg-gradient-to-r from-amber-50 to-yellow-50 rounded-2xl border border-amber-200 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-xl bg-amber-500 text-white flex items-center justify-center shadow-xs">
                    <span className="material-symbols-outlined text-base">stars</span>
                  </div>
                  <div>
                    <p className="text-xs font-bold text-amber-900">
                      Điểm Hạt Vàng Tích Lũy
                    </p>
                    <p className="text-[10px] text-amber-700">
                      Chỉ đọc • Tự động quản lý qua đơn hàng
                    </p>
                  </div>
                </div>
                <div className="px-3 py-1 bg-white rounded-xl border border-amber-300 font-extrabold text-amber-900 text-sm shadow-2xs">
                  {(editingCustomer.loyaltyPoints || 0).toLocaleString("vi-VN")} hạt
                </div>
              </div>

              {/* Email (Read-only) */}
              <div>
                <label className="block text-xs font-bold text-[#7A6A5E] mb-1">
                  Email đăng nhập (Không thể thay đổi)
                </label>
                <input
                  type="text"
                  disabled
                  value={editingCustomer.email}
                  className="w-full px-3.5 py-2 rounded-xl bg-[#F3ECE4]/60 border border-[#E6DDD5] text-xs font-mono font-semibold text-[#7A6A5E] cursor-not-allowed"
                />
              </div>

              {/* Họ và tên */}
              <div>
                <label className="block text-xs font-bold text-[#2C1E18] mb-1">
                  Họ và tên khách hàng *
                </label>
                <input
                  type="text"
                  required
                  value={editFullName}
                  onChange={(e) => setEditFullName(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-xl bg-[#FAF6F0] border border-[#E6DDD5] text-xs font-semibold focus:outline-none focus:border-[#9E5A2B]"
                />
              </div>

              {/* Số điện thoại */}
              <div>
                <label className="block text-xs font-bold text-[#2C1E18] mb-1">
                  Số điện thoại
                </label>
                <input
                  type="tel"
                  value={editPhone}
                  onChange={(e) => setEditPhone(e.target.value)}
                  placeholder="09xxxxxxxx"
                  className="w-full px-3.5 py-2 rounded-xl bg-[#FAF6F0] border border-[#E6DDD5] text-xs font-semibold focus:outline-none focus:border-[#9E5A2B]"
                />
              </div>

              {/* Trạng thái tài khoản */}
              <div>
                <label className="block text-xs font-bold text-[#2C1E18] mb-1">
                  Trạng thái tài khoản *
                </label>
                <select
                  value={editIsActive ? "ACTIVE" : "INACTIVE"}
                  onChange={(e) => setEditIsActive(e.target.value === "ACTIVE")}
                  className="w-full px-3 py-2 rounded-xl bg-[#FAF6F0] border border-[#E6DDD5] text-xs font-bold text-[#2C1E18] focus:outline-none focus:border-[#9E5A2B]"
                >
                  <option value="ACTIVE">✅ Đang hoạt động (Cho phép đặt hàng)</option>
                  <option value="INACTIVE">🔒 Tạm khóa (Chặn đăng nhập)</option>
                </select>
              </div>

              {/* Cấp lại mật khẩu mới */}
              <div className="p-3 bg-[#FAF6F0] rounded-xl border border-[#E6DDD5]">
                <label className="block text-xs font-bold text-[#2C1E18] mb-1">
                  Cấp lại mật khẩu mới
                </label>
                <input
                  type="text"
                  value={editNewPassword}
                  onChange={(e) => setEditNewPassword(e.target.value)}
                  placeholder="Bỏ trống nếu không muốn đổi mật khẩu"
                  className="w-full px-3 py-1.5 rounded-lg bg-white border border-[#E6DDD5] text-xs font-mono font-medium focus:outline-none focus:border-[#9E5A2B]"
                />
                <p className="text-[10px] text-[#7A6A5E] mt-1">
                  Chỉ nhập khi khách hàng yêu cầu reset lại mật khẩu truy cập.
                </p>
              </div>

              {/* Nút thao tác */}
              <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#E6DDD5]">
                <button
                  type="button"
                  onClick={() => setIsEditModalOpen(false)}
                  className="px-4 py-2 rounded-xl bg-[#F3ECE4] hover:bg-[#E6DDD5] text-xs font-bold text-[#7A6A5E] transition-colors cursor-pointer"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingEdit}
                  className="px-5 py-2 rounded-xl bg-[#9E5A2B] hover:bg-[#78350F] text-white text-xs font-bold transition-all shadow-sm cursor-pointer disabled:opacity-50"
                >
                  {isSubmittingEdit ? "Đang lưu..." : "Lưu Thay Đổi"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ===================================================================
          MODAL 3: XÁC NHẬN XÓA THÔNG MINH (SMART DELETE CONFIRMATION)
         =================================================================== */}
      {deletingCustomer && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-red-200">
            <div className="flex items-center gap-3 text-red-600 mb-3">
              <div className="w-10 h-10 rounded-2xl bg-red-100 flex items-center justify-center shrink-0">
                <span className="material-symbols-outlined text-[24px]">
                  warning
                </span>
              </div>
              <div>
                <h3 className="font-headline text-base font-extrabold text-[#2C1E18]">
                  Xác Nhận Xóa Khách Hàng
                </h3>
                <p className="text-[11px] text-[#7A6A5E]">
                  Cơ chế Smart Delete bảo toàn lịch sử hóa đơn
                </p>
              </div>
            </div>

            <div className="p-3.5 bg-[#FAF6F0] rounded-2xl border border-[#E6DDD5] my-3 space-y-1.5 text-xs">
              <p>
                <span className="text-[#7A6A5E]">Họ tên:</span>{" "}
                <strong className="text-[#2C1E18]">{deletingCustomer.fullName}</strong>
              </p>
              <p>
                <span className="text-[#7A6A5E]">Email:</span>{" "}
                <strong className="text-[#2C1E18]">{deletingCustomer.email}</strong>
              </p>
              <p>
                <span className="text-[#7A6A5E]">Số đơn hàng đã đặt:</span>{" "}
                <strong className="text-amber-800 font-extrabold">
                  {deletingCustomer._count?.orders ?? 0} đơn
                </strong>
              </p>
            </div>

            {/* Giải thích cơ chế Smart Delete */}
            <div
              className={`p-3 rounded-xl border text-xs leading-relaxed ${
                (deletingCustomer._count?.orders ?? 0) > 0
                  ? "bg-amber-50 border-amber-300 text-amber-900"
                  : "bg-red-50 border-red-200 text-red-900"
              }`}
            >
              {(deletingCustomer._count?.orders ?? 0) > 0 ? (
                <div>
                  <p className="font-bold flex items-center gap-1">
                    <span className="material-symbols-outlined text-sm">
                      shield
                    </span>
                    Bảo toàn dữ liệu hóa đơn:
                  </p>
                  <p className="text-[11px] mt-0.5">
                    Khách hàng này đã có <strong>{deletingCustomer._count?.orders}</strong> đơn hàng. Hệ thống sẽ tự động <strong>Tạm Khóa</strong> tài khoản thay vì xóa vĩnh viễn nhằm đảm bảo toàn vẹn báo cáo doanh thu và lịch sử đơn hàng.
                  </p>
                </div>
              ) : (
                <div>
                  <p className="font-bold flex items-center gap-1">
                    <span className="material-symbols-outlined text-sm">
                      delete_forever
                    </span>
                    Xóa hoàn toàn tài khoản:
                  </p>
                  <p className="text-[11px] mt-0.5">
                    Khách hàng chưa phát sinh đơn hàng nào. Dữ liệu tài khoản sẽ được <strong>xóa vĩnh viễn</strong> khỏi hệ thống và không thể khôi phục.
                  </p>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 mt-5 pt-3 border-t border-[#E6DDD5]">
              <button
                type="button"
                onClick={() => setDeletingCustomer(null)}
                className="px-4 py-2 rounded-xl bg-[#F3ECE4] hover:bg-[#E6DDD5] text-xs font-bold text-[#7A6A5E] transition-colors cursor-pointer"
              >
                Hủy bỏ
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                disabled={isDeleting}
                className="px-5 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-bold transition-all shadow-sm cursor-pointer disabled:opacity-50"
              >
                {isDeleting ? "Đang xử lý..." : "Xác Nhận Xóa"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
