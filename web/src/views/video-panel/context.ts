// What the video panel needs from the chat view.

import { type VoiceClient } from "../../voice";

/** What the panel needs from the chat view: the DOM it lays tiles into
 * and the controls it keeps in sync, the voice client, and two callbacks. */
export interface VideoPanelContext {
  globalCameraBtn: HTMLButtonElement;
  globalScreenBtn: HTMLButtonElement;
  headerCameraBtn: HTMLButtonElement;
  hideChatBtn: HTMLButtonElement;
  renderDmCallStage: () => void;
  rotateGridBtn: HTMLButtonElement;
  separateWebcamBtn: HTMLButtonElement;
  stageCameraBtn: HTMLButtonElement;
  stageScreenBtn: HTMLButtonElement;
  videoChatResizeHandle: HTMLDivElement;
  videoTiles: HTMLDivElement;
  videoTilesPanel: HTMLDivElement;
  voiceClient: VoiceClient;
  wireRemoteVolumeSlider: (slider: HTMLInputElement, userId: string) => void;
  /** Whether the chat column is hidden (owned by the chat view; read live). */
  readonly chatHidden: boolean;
}
