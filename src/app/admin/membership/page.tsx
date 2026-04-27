import { isMemberAdminEnabled } from "../../../lib/member-service";

import { AdminMembershipClient } from "./AdminMembershipClient";

export default function MembershipAdminPage() {
  if (!isMemberAdminEnabled()) {
    return <section className="panel">会员后台暂未开放。</section>;
  }

  return <AdminMembershipClient />;
}
