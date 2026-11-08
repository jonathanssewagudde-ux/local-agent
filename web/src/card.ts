import cardJson from "./card.generated.json";

export type RoomKey = "briefing" | "meeting" | "approval" | "workspace" | "command" | "server" | "pantry" | "lounge";
export const ROOM_KEYS: RoomKey[] = ["briefing", "meeting", "approval", "workspace", "command", "server", "pantry", "lounge"];
export type Member = { name: string; role: string; worksIn: "command" | "workspace" | "server"; character: string; details?: string };
export type Card = { appName: string; uiAccent: string; team: Member[]; rooms: Record<RoomKey, string> };

export const card = cardJson as Card;
export const lead = card.team[0];
export const memberNames = card.team.map((m) => m.name);
export const isMember = (n: string | null | undefined): n is string => !!n && memberNames.includes(n);
export const member = (n: string) => card.team.find((m) => m.name === n);
