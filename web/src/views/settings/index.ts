// Your own Settings: its pages, in the shared settings shell (shell.ts).

import { type User } from "../../api";
import { renderAvatarEl } from "../../ui";
import { type VoiceClient } from "../../voice";
import { renderGlobalAdminSection } from "../global-admin";
import { renderAccountSection, renderDangerSection, renderLogoutSection } from "./account";
import { renderDevicesSection } from "./devices";
import { renderProfileSection } from "./profile";
import { renderSecuritySection } from "./security";
import { openSettingsShell, type ShellTab } from "./shell";

export type SettingsTab = "profile" | "devices" | "security" | "account" | "admin" | "logout" | "danger";

export function renderSettings(opts: {
  user: User;
  isOwner: boolean;
  mfaEnabled: boolean;
  onMfaChanged: () => void;
  onUserUpdated: (user: User) => void;
  voiceClient: VoiceClient;
  onLoggedOut: () => void;
  /** The pane to open first (the first one by default). */
  initialTab?: SettingsTab;
}): void {
  const shell = openSettingsShell<SettingsTab>({});
  const showIdentity = (user: User): void =>
    shell.setIdentity(
      renderAvatarEl(user.display_name, user.avatar_file_id),
      user.display_name,
      `@${user.username}`,
    );
  showIdentity(opts.user);

  const onUserUpdated = (user: User): void => {
    opts.user = user;
    showIdentity(user);
    opts.onUserUpdated(user);
  };

  const tabs: ShellTab<SettingsTab>[] = [
    {
      id: "profile",
      label: "Profile",
      iconName: "user",
      render: (c) => renderProfileSection(c, opts.user, onUserUpdated),
    },
    {
      id: "devices",
      label: "Devices",
      iconName: "headphones",
      render: (c) => renderDevicesSection(c, opts.voiceClient),
    },
    {
      id: "security",
      label: "Security",
      iconName: "shield",
      render: (c) =>
        renderSecuritySection(c, opts.mfaEnabled, opts.onMfaChanged, opts.user.accepts_friend_requests),
    },
    { id: "account", label: "Account", iconName: "external-link", render: (c) => renderAccountSection(c) },
    ...(opts.isOwner
      ? [
          {
            id: "admin" as const,
            label: "Global admin",
            iconName: "users" as const,
            render: (c: HTMLElement) => renderGlobalAdminSection(c),
          },
        ]
      : []),
    {
      id: "logout",
      label: "Log out",
      iconName: "log-out",
      caution: true,
      render: (c) => renderLogoutSection(c, opts.onLoggedOut),
    },
    {
      id: "danger",
      label: "Danger",
      iconName: "trash",
      caution: true,
      render: (c) => renderDangerSection(c, opts.user, opts.onLoggedOut),
    },
  ];
  shell.setTabs(tabs, opts.initialTab);
}
