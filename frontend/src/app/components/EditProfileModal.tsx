"use client";

import React, { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import {
  User,
  Mail,
  Phone,
  Lock,
  Eye,
  EyeOff,
  AlertCircle,
  CheckCircle2,
  X,
  Loader2,
  ShieldCheck,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { useAuthStore, apiFetch } from "../store/authStore";

export interface EditProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (message: string) => void;
}

export default function EditProfileModal({
  isOpen,
  onClose,
  onSuccess,
}: EditProfileModalProps) {
  const { user, refreshProfile } = useAuthStore();

  const [mounted, setMounted] = useState(false);
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");

  // Change password toggle & fields
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  // Show/Hide password toggles
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // States for submission
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Sync state whenever modal opens or user updates
  useEffect(() => {
    if (isOpen) {
      setFullName(user?.fullName || "");
      setPhone(user?.phone || "");
      setIsChangingPassword(false);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setShowCurrentPassword(false);
      setShowNewPassword(false);
      setShowConfirmPassword(false);
      setErrorMessage(null);
      setSuccessMessage(null);
    }
  }, [isOpen, user]);

  if (!isOpen || !mounted) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    // Client-side validation
    const trimmedName = fullName.trim();
    if (!trimmedName) {
      setErrorMessage("Vui lòng nhập họ và tên của bạn.");
      return;
    }

    if (isChangingPassword) {
      if (!currentPassword) {
        setErrorMessage("Vui lòng nhập mật khẩu hiện tại để xác thực đổi mật khẩu.");
        return;
      }
      if (!newPassword || newPassword.length < 6) {
        setErrorMessage("Mật khẩu mới phải có ít nhất 6 ký tự.");
        return;
      }
      if (newPassword !== confirmPassword) {
        setErrorMessage("Nhập lại mật khẩu mới không khớp. Vui lòng kiểm tra lại.");
        return;
      }
      if (currentPassword === newPassword) {
        setErrorMessage("Mật khẩu mới không được trùng với mật khẩu hiện tại.");
        return;
      }
    }

    setIsLoading(true);

    try {
      const payload: {
        fullName: string;
        phone?: string;
        currentPassword?: string;
        newPassword?: string;
      } = {
        fullName: trimmedName,
        phone: phone.trim() ? phone.trim() : undefined,
      };

      if (isChangingPassword) {
        payload.currentPassword = currentPassword;
        payload.newPassword = newPassword;
      }

      const res = await apiFetch("/auth/profile", {
        method: "PATCH",
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        let msg = "Cập nhật hồ sơ thất bại. Vui lòng kiểm tra lại thông tin.";
        if (data?.message) {
          msg = Array.isArray(data.message)
            ? data.message.join(", ")
            : data.message;
        }
        setErrorMessage(msg);
        setIsLoading(false);
        return;
      }

      // Cập nhật thành công -> refresh profile trong Zustand store
      await refreshProfile();

      const successNotice = isChangingPassword
        ? "Cập nhật thông tin và đổi mật khẩu thành công!"
        : "Cập nhật thông tin hồ sơ thành công!";

      setSuccessMessage(successNotice);

      if (onSuccess) {
        onSuccess(successNotice);
      }

      // Tự động đóng modal sau 900ms để người dùng nhìn thấy thông báo thành công
      setTimeout(() => {
        onClose();
      }, 900);
    } catch {
      setErrorMessage("Không thể kết nối đến máy chủ. Vui lòng thử lại sau.");
    } finally {
      setIsLoading(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[11000] overflow-y-auto bg-black/60 backdrop-blur-[3px] flex items-center justify-center p-3 sm:p-4 animate-[fadeIn_0.2s_ease-out] font-body"
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-profile-title"
    >
      {/* Backdrop click to close */}
      <div
        className="fixed inset-0"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal Dialog Card */}
      <div
        className="relative w-full max-w-lg bg-[#FAF6F0] rounded-3xl shadow-2xl border border-[#2C1810]/15 overflow-hidden flex flex-col z-10 max-h-[92vh] my-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Modal Header ── */}
        <div className="px-6 py-4 bg-white border-b border-[#E6DDD5] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-[#FAF0E6] text-[#78350F] flex items-center justify-center shadow-xs border border-[#E6DDD5]">
              <User size={20} className="text-[#78350F]" strokeWidth={2.2} />
            </div>
            <div>
              <h2
                id="edit-profile-title"
                className="font-headline text-base sm:text-lg font-bold text-[#1D1B19] leading-snug"
              >
                Chỉnh sửa hồ sơ cá nhân
              </h2>
              <p className="text-xs text-[#827470]">
                Cập nhật thông tin liên hệ & quản lý mật khẩu tài khoản
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-stone-400 hover:text-stone-800 hover:bg-[#F3EDE9] transition-colors cursor-pointer"
            aria-label="Đóng cửa sổ"
          >
            <X size={18} />
          </button>
        </div>

        {/* ── Modal Body (Scrollable Form) ── */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {/* Alert Message Banners */}
          {errorMessage && (
            <div className="p-3.5 bg-red-50 border border-red-200 rounded-2xl text-xs text-red-800 flex items-start gap-2.5 animate-[fadeIn_0.2s_ease-out]">
              <AlertCircle size={18} className="text-red-600 shrink-0 mt-0.5" />
              <div className="flex-1 font-medium">{errorMessage}</div>
            </div>
          )}

          {successMessage && (
            <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-2xl text-xs text-emerald-800 flex items-start gap-2.5 animate-[fadeIn_0.2s_ease-out]">
              <CheckCircle2 size={18} className="text-emerald-600 shrink-0 mt-0.5" />
              <div className="flex-1 font-medium">{successMessage}</div>
            </div>
          )}

          {/* ── 1. Basic Info Section ── */}
          <div className="space-y-4">
            {/* Email Field (Read-only / Disabled) */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-[#1D1B19] flex items-center gap-1.5">
                  <Mail size={14} className="text-[#845326]" />
                  <span>Địa chỉ Email</span>
                </label>
                <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-stone-200/80 text-stone-600 border border-stone-300">
                  <ShieldCheck size={11} className="text-stone-500" />
                  Định danh đăng nhập (Không thể thay đổi)
                </span>
              </div>
              <div className="relative">
                <input
                  type="email"
                  value={user?.email || ""}
                  disabled
                  readOnly
                  className="w-full pl-9 pr-3 py-2.5 text-xs sm:text-sm bg-stone-100 text-stone-500 rounded-xl border border-stone-200 cursor-not-allowed select-none font-medium"
                />
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-stone-400">
                  <Mail size={15} />
                </div>
              </div>
              <p className="text-[11px] text-stone-400 italic">
                Email dùng để đăng nhập và bảo mật các giao dịch đặt món.
              </p>
            </div>

            {/* Full Name Field */}
            <div className="space-y-1.5">
              <label
                htmlFor="profile-fullname"
                className="text-xs font-bold text-[#1D1B19] flex items-center gap-1.5"
              >
                <User size={14} className="text-[#845326]" />
                <span>Họ và tên <strong className="text-red-500">*</strong></span>
              </label>
              <div className="relative">
                <input
                  id="profile-fullname"
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Ví dụ: Nguyễn Văn A"
                  className="w-full pl-9 pr-3 py-2.5 text-xs sm:text-sm bg-white text-[#1D1B19] rounded-xl border border-[#E6DDD5] focus:outline-none focus:ring-2 focus:ring-[#78350F]/20 focus:border-[#78350F] transition-all font-medium placeholder:text-stone-400 shadow-2xs"
                />
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-stone-400">
                  <User size={15} />
                </div>
              </div>
            </div>

            {/* Phone Number Field */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label
                  htmlFor="profile-phone"
                  className="text-xs font-bold text-[#1D1B19] flex items-center gap-1.5"
                >
                  <Phone size={14} className="text-[#845326]" />
                  <span>Số điện thoại</span>
                </label>
                <span className="text-[10px] text-stone-400 font-medium">(Tùy chọn)</span>
              </div>
              <div className="relative">
                <input
                  id="profile-phone"
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="Ví dụ: 0901 234 567"
                  className="w-full pl-9 pr-3 py-2.5 text-xs sm:text-sm bg-white text-[#1D1B19] rounded-xl border border-[#E6DDD5] focus:outline-none focus:ring-2 focus:ring-[#78350F]/20 focus:border-[#78350F] transition-all font-medium placeholder:text-stone-400 shadow-2xs"
                />
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-stone-400">
                  <Phone size={15} />
                </div>
              </div>
              <p className="text-[11px] text-stone-400">
                Dùng để nhân viên BrewLite liên hệ khi giao nhận thức uống.
              </p>
            </div>
          </div>

          {/* ── 2. Password Change Accordion Block ── */}
          <div className="border border-[#E6DDD5] rounded-2xl bg-white overflow-hidden shadow-2xs transition-all">
            <button
              type="button"
              onClick={() => {
                setIsChangingPassword(!isChangingPassword);
                setErrorMessage(null);
              }}
              className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-[#FAF6F0] transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-2.5">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${
                  isChangingPassword ? "bg-[#78350F] text-white" : "bg-[#FAF0E6] text-[#78350F]"
                }`}>
                  <Lock size={16} />
                </div>
                <div>
                  <h3 className="text-xs sm:text-sm font-bold text-[#1D1B19]">
                    Tôi muốn đổi mật khẩu đăng nhập
                  </h3>
                  <p className="text-[11px] text-[#827470]">
                    Bảo vệ an toàn tài khoản bằng mật khẩu bảo mật cao
                  </p>
                </div>
              </div>
              <div className="text-stone-400">
                {isChangingPassword ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
              </div>
            </button>

            {isChangingPassword && (
              <div className="p-4 pt-1 border-t border-[#E6DDD5] bg-[#FAF6F0]/40 space-y-3.5 animate-[fadeIn_0.2s_ease-out]">
                {/* Mật khẩu hiện tại */}
                <div className="space-y-1.5">
                  <label
                    htmlFor="current-password"
                    className="text-xs font-bold text-[#1D1B19] flex items-center justify-between"
                  >
                    <span>Mật khẩu hiện tại <strong className="text-red-500">*</strong></span>
                  </label>
                  <div className="relative">
                    <input
                      id="current-password"
                      type={showCurrentPassword ? "text" : "password"}
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      placeholder="Nhập mật khẩu bạn đang dùng"
                      className="w-full pl-9 pr-10 py-2 text-xs sm:text-sm bg-white text-[#1D1B19] rounded-xl border border-[#E6DDD5] focus:outline-none focus:ring-2 focus:ring-[#78350F]/20 focus:border-[#78350F] transition-all font-medium placeholder:text-stone-400"
                    />
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-stone-400">
                      <Lock size={15} />
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                      className="absolute inset-y-0 right-0 pr-3 flex items-center text-stone-400 hover:text-stone-700 cursor-pointer"
                      tabIndex={-1}
                      aria-label={showCurrentPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
                    >
                      {showCurrentPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>

                {/* Mật khẩu mới */}
                <div className="space-y-1.5">
                  <label
                    htmlFor="new-password"
                    className="text-xs font-bold text-[#1D1B19] flex items-center justify-between"
                  >
                    <span>Mật khẩu mới <strong className="text-red-500">*</strong></span>
                    <span className="text-[10px] text-stone-400 font-normal">Tối thiểu 6 ký tự</span>
                  </label>
                  <div className="relative">
                    <input
                      id="new-password"
                      type={showNewPassword ? "text" : "password"}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="Tối thiểu 6 ký tự"
                      className="w-full pl-9 pr-10 py-2 text-xs sm:text-sm bg-white text-[#1D1B19] rounded-xl border border-[#E6DDD5] focus:outline-none focus:ring-2 focus:ring-[#78350F]/20 focus:border-[#78350F] transition-all font-medium placeholder:text-stone-400"
                    />
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-stone-400">
                      <Lock size={15} />
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowNewPassword(!showNewPassword)}
                      className="absolute inset-y-0 right-0 pr-3 flex items-center text-stone-400 hover:text-stone-700 cursor-pointer"
                      tabIndex={-1}
                      aria-label={showNewPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
                    >
                      {showNewPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>

                {/* Nhập lại mật khẩu mới */}
                <div className="space-y-1.5">
                  <label
                    htmlFor="confirm-password"
                    className="text-xs font-bold text-[#1D1B19] flex items-center justify-between"
                  >
                    <span>Nhập lại mật khẩu mới <strong className="text-red-500">*</strong></span>
                    {confirmPassword && newPassword === confirmPassword && (
                      <span className="text-[10px] text-emerald-600 font-bold flex items-center gap-0.5">
                        <CheckCircle2 size={11} /> Mật khẩu khớp
                      </span>
                    )}
                  </label>
                  <div className="relative">
                    <input
                      id="confirm-password"
                      type={showConfirmPassword ? "text" : "password"}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Nhập lại mật khẩu mới vừa nhập"
                      className={`w-full pl-9 pr-10 py-2 text-xs sm:text-sm bg-white text-[#1D1B19] rounded-xl border transition-all font-medium placeholder:text-stone-400 ${
                        confirmPassword && newPassword !== confirmPassword
                          ? "border-red-400 focus:ring-red-200"
                          : "border-[#E6DDD5] focus:ring-[#78350F]/20 focus:border-[#78350F]"
                      }`}
                    />
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-stone-400">
                      <Lock size={15} />
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      className="absolute inset-y-0 right-0 pr-3 flex items-center text-stone-400 hover:text-stone-700 cursor-pointer"
                      tabIndex={-1}
                      aria-label={showConfirmPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
                    >
                      {showConfirmPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                  {confirmPassword && newPassword !== confirmPassword && (
                    <p className="text-[11px] text-red-500 font-medium">
                      Mật khẩu nhập lại chưa khớp với mật khẩu mới.
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* ── Modal Footer Buttons ── */}
          <div className="pt-3 border-t border-[#E6DDD5] flex items-center justify-end gap-3 shrink-0">
            <button
              type="button"
              onClick={onClose}
              disabled={isLoading}
              className="px-5 py-2.5 rounded-full border border-[#E6DDD5] bg-white text-stone-600 hover:bg-[#F3EDE9] text-xs sm:text-sm font-semibold transition-colors cursor-pointer disabled:opacity-50"
            >
              Hủy bỏ
            </button>
            <button
              type="submit"
              disabled={isLoading}
              className="px-6 py-2.5 rounded-full bg-[#2C1810] hover:bg-[#78350F] text-white text-xs sm:text-sm font-bold shadow-md hover:shadow-lg transition-all flex items-center gap-2 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {isLoading ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  <span>Đang lưu thay đổi...</span>
                </>
              ) : (
                <span>Lưu thay đổi</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
