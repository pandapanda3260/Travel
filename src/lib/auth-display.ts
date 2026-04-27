import type {
  AdminRole,
  AdminStatus,
  AuthUserStatus,
  RiskBlockType,
  SmsCodePurpose,
  UserLoginType,
  UserSecurityActionType,
} from "./auth-store";

const dateTimeFormatter = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

export function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return "暂无";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return dateTimeFormatter.format(date);
}

export function formatLoginType(type: UserLoginType) {
  return type === "sms" ? "短信验证码" : "手机号密码";
}

export function formatUserStatus(status: AuthUserStatus) {
  switch (status) {
    case "normal":
      return "正常";
    case "banned":
      return "已封禁";
    case "merged":
      return "已合并";
    default:
      return status;
  }
}

export function formatAdminRole(role: AdminRole) {
  switch (role) {
    case "super_admin":
      return "超级管理员";
    case "operator":
      return "运营";
    case "viewer":
      return "只读";
    default:
      return role;
  }
}

export function formatAdminStatus(status: AdminStatus) {
  return status === "active" ? "启用" : "停用";
}

export function formatRiskBlockType(type: RiskBlockType) {
  return type === "phone" ? "手机号" : "IP";
}

export function formatUserSecurityAction(action: UserSecurityActionType) {
  switch (action) {
    case "update_profile":
      return "资料更新";
    case "set_password":
      return "密码变更";
    case "reset_password":
      return "重置密码";
    case "bind_phone":
      return "绑定手机号";
    case "change_phone":
      return "换绑手机号";
    case "logout_other_sessions":
      return "全部设备下线";
    case "revoke_session":
      return "单设备下线";
    default:
      return action;
  }
}

export function formatSmsCodePurpose(purpose: SmsCodePurpose) {
  switch (purpose) {
    case "login":
      return "登录验证码";
    case "bind_phone":
      return "绑定手机号";
    case "reset_password":
      return "重置密码";
    case "change_phone_old":
      return "旧号校验";
    case "change_phone_new":
      return "新号校验";
    default:
      return purpose;
  }
}

export function formatAdminActionType(actionType: string) {
  switch (actionType) {
    case "admin_login":
      return "后台登录";
    case "view_user_detail":
      return "查看用户详情";
    case "export_users":
      return "导出用户";
    case "export_user_detail":
      return "导出用户详情";
    case "force_logout_user":
      return "强制用户下线";
    case "manual_repair_phone":
      return "修正手机号";
    case "manual_reset_password":
      return "重置用户密码";
    case "merge_user":
      return "合并账号";
    case "unbind_account":
      return "解绑密码账号";
    case "unbind_phone":
      return "解绑手机号";
    case "refresh_auth_dashboard":
      return "刷新账号看板";
    case "update_risk_config":
      return "更新安全配置";
    case "add_risk_block":
      return "新增风控限制";
    case "remove_risk_block":
      return "移除风控限制";
    case "create_operator":
      return "创建运营账号";
    case "update_operator":
      return "更新运营账号";
    default:
      return actionType;
  }
}
