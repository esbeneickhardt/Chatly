// What the Ctrl/Cmd+K quick switcher offers: every channel of every server,
// every conversation, every server, and the actions you can take from here.

import { type Channel, type Guild, type User, api } from "../../api";
import { type Command, type PaletteSource } from "../../command-palette";
import { renderAddServerModal, renderInviteModal } from "../servers";
import { type ChannelsParts } from "./channels";
import { type DirectMessagesParts } from "./direct-messages";
import { type GuildRailParts } from "./guild-rail";
import { type NavigationParts } from "./navigation";
import { type SidebarParts } from "./sidebar";
import { type VoiceControlsParts } from "./voice-controls";
import type { ChatState } from "./state";

/** What the switcher needs from the rest of the chat screen. */
export interface CommandsContext {
  directMessages: DirectMessagesParts;
  sidebarParts: SidebarParts;
  guildRail2: GuildRailParts;
  voiceControls: VoiceControlsParts;
  navigation: NavigationParts;
  channels: ChannelsParts;
  onLoggedOut: () => void;
  state: ChatState;
  user: User;
}

/** How long another server's channel list is reused between openings. */
const CHANNEL_CACHE_MS = 60_000;

export function createCommands(ctx: CommandsContext) {
  const { onLoggedOut, state, user } = ctx;
  const { dmLabel, openSearch, selectDm } = ctx.directMessages;
  const { createChannelBtn, friendRequestsBtn, globalDeafenBtn, globalMuteBtn, manageGuildBtn, newDmBtn } =
    ctx.sidebarParts;
  const { defaultGuildInviteChannelId } = ctx.guildRail2;
  const { handleLeaveVoice, handleToggleCamera, handleToggleScreen, openSettings, voiceClient } =
    ctx.voiceControls;
  const { switchGuild, switchToHome } = ctx.navigation;
  const { selectChannel, toggleVoiceChannel } = ctx.channels;

  const otherServers = new Map<string, { at: number; channels: Channel[] }>();

  function channelCommand(channel: Channel, guild: Guild | null, open: () => void): Command {
    const voice = channel.kind === "voice";
    return {
      id: `channel:${channel.id}`,
      label: guild ? `${guild.name} › ${channel.name}` : channel.name,
      group: "channel",
      hint: voice ? "voice channel" : "channel",
      iconName: voice ? "volume-2" : "hash",
      keywords: guild ? "" : (state.activeGuild?.name ?? ""),
      run: open,
    };
  }

  function openChannel(channel: Channel): void {
    if (channel.kind === "voice") void toggleVoiceChannel(channel);
    else selectChannel(channel);
  }

  function currentServerChannels(): Command[] {
    if (state.onHome) return [];
    return state.currentChannels
      .filter((c) => c.kind !== "category")
      .map((channel) => channelCommand(channel, null, () => openChannel(channel)));
  }

  function directMessageCommands(): Command[] {
    return state.dms.map((dm) => ({
      id: `dm:${dm.channel.id}`,
      label: dmLabel(dm),
      group: "dm" as const,
      hint: dm.participants.length > 1 ? "group chat" : "direct message",
      iconName: "user" as const,
      keywords: dm.participants.map((p) => `${p.username} ${p.display_name}`).join(" "),
      run: () => void switchToHome().then(() => selectDm(dm)),
    }));
  }

  function serverCommands(): Command[] {
    return state.guilds.map((g) => ({
      id: `guild:${g.id}`,
      label: g.name,
      group: "server" as const,
      hint: "server",
      iconName: "users" as const,
      run: () => void switchGuild(g),
    }));
  }

  function callCommands(): Command[] {
    if (voiceClient.currentChannelId === null) return [];
    return [
      {
        id: "action:camera",
        label: voiceClient.hasLocalCamera ? "Turn off camera" : "Turn on camera",
        group: "action",
        iconName: "video",
        keywords: "webcam video",
        run: handleToggleCamera,
      },
      {
        id: "action:screen",
        label: voiceClient.hasLocalScreenShare ? "Stop sharing your screen" : "Share your screen",
        group: "action",
        iconName: "monitor",
        keywords: "present stream",
        run: handleToggleScreen,
      },
      {
        id: "action:leave-call",
        label: "Leave the call",
        group: "action",
        iconName: "phone-off",
        keywords: "disconnect hang up end",
        run: handleLeaveVoice,
      },
    ];
  }

  function actionCommands(): Command[] {
    const actions: Command[] = [
      {
        id: "action:mute",
        label: voiceClient.isMuted ? "Unmute microphone" : "Mute microphone",
        group: "action",
        iconName: voiceClient.isMuted ? "mic-off" : "mic",
        run: () => globalMuteBtn.click(),
      },
      {
        id: "action:deafen",
        label: voiceClient.isDeafened ? "Undeafen" : "Deafen",
        group: "action",
        iconName: voiceClient.isDeafened ? "headphones-off" : "headphones",
        run: () => globalDeafenBtn.click(),
      },
      ...callCommands(),
      {
        id: "action:search",
        label: "Search messages",
        group: "action",
        hint: "Ctrl+Shift+F",
        iconName: "search",
        run: openSearch,
      },
      {
        id: "action:add-server",
        label: "Add a server",
        group: "action",
        hint: "create or join",
        iconName: "plus",
        run: () =>
          renderAddServerModal({
            onJoined: (g) => {
              state.guilds = [...state.guilds, g];
              void switchGuild(g);
            },
          }),
      },
    ];

    const inviteChannelId = defaultGuildInviteChannelId();
    if (state.activeGuild && inviteChannelId) {
      const guildName = state.activeGuild.name;
      actions.push({
        id: "action:invite",
        label: `Invite people to ${guildName}`,
        group: "action",
        iconName: "user-plus",
        run: () => renderInviteModal({ title: `Invite people to ${guildName}`, channelId: inviteChannelId }),
      });
      if (!createChannelBtn.hidden) {
        actions.push({
          id: "action:create-channel",
          label: "Create a channel",
          group: "action",
          iconName: "plus",
          run: () => createChannelBtn.click(),
        });
      }
    }
    if (!manageGuildBtn.hidden && state.activeGuild) {
      actions.push({
        id: "action:manage-server",
        label: `Manage ${state.activeGuild.name}`,
        group: "action",
        hint: "server settings",
        iconName: "settings",
        keywords: "roles members admins audit",
        run: () => manageGuildBtn.click(),
      });
    }

    actions.push(
      {
        id: "action:new-dm",
        label: "Add a friend",
        group: "action",
        iconName: "user-plus",
        run: () => newDmBtn.click(),
      },
      {
        id: "action:friend-requests",
        label: "Friend requests",
        group: "action",
        iconName: "users",
        run: () => friendRequestsBtn.click(),
      },
      {
        id: "action:home",
        label: "Go to Direct Messages",
        group: "action",
        iconName: "message-circle",
        keywords: "home dms",
        run: () => void switchToHome(),
      },
      {
        id: "action:settings",
        label: "Open settings",
        group: "action",
        iconName: "settings",
        keywords: "profile devices security account",
        run: () => openSettings(),
      },
      {
        id: "action:devices",
        label: "Choose microphone and speakers",
        group: "action",
        iconName: "headphones",
        keywords: "audio input output volume devices",
        run: () => openSettings("devices"),
      },
    );
    if (user.is_owner) {
      actions.push({
        id: "action:global-admin",
        label: "Global admin",
        group: "action",
        hint: "all accounts and servers",
        iconName: "shield",
        keywords: "instance accounts servers activity",
        run: () => openSettings("admin"),
      });
    }
    actions.push({
      id: "action:logout",
      label: "Log out",
      group: "action",
      iconName: "log-out",
      run: () => {
        void api.post("/api/logout").then(onLoggedOut);
      },
    });
    return actions;
  }

  /** The channels of every server other than the one open now — one request
   * each, reused for a minute. */
  async function otherServerChannels(): Promise<Command[]> {
    const commands: Command[] = [];
    await Promise.all(
      state.guilds
        .filter((g) => g.id !== state.activeGuild?.id || state.onHome)
        .map(async (guild) => {
          let entry = otherServers.get(guild.id);
          if (!entry || Date.now() - entry.at > CHANNEL_CACHE_MS) {
            try {
              entry = {
                at: Date.now(),
                channels: await api.get<Channel[]>(`/api/guilds/${guild.id}/channels`),
              };
              otherServers.set(guild.id, entry);
            } catch {
              return;
            }
          }
          for (const channel of entry.channels) {
            if (channel.kind === "category") continue;
            commands.push(
              channelCommand(channel, guild, () => {
                void switchGuild(guild).then(() => {
                  const current = state.currentChannels.find((c) => c.id === channel.id) ?? channel;
                  openChannel(current);
                });
              }),
            );
          }
        }),
    );
    return commands;
  }

  const source: PaletteSource = {
    commands: () => [
      ...currentServerChannels(),
      ...directMessageCommands(),
      ...serverCommands(),
      ...actionCommands(),
    ],
    more: otherServerChannels,
    searchMessages: () => openSearch(),
  };

  return { source };
}
