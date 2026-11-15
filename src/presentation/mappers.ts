import type { Note, Team } from '../domain/entities.js';
import type { NoteDto } from './schemas/note.js';
import type { TeamDto } from './schemas/team.js';

export const toNoteDto = (note: Note): NoteDto => ({
  id: note.id,
  owner_id: note.ownerId,
  title: note.title,
  body: note.body,
  team_ids: note.teamIds,
  created_at: note.createdAt,
  updated_at: note.updatedAt,
});

export const toTeamDto = (team: Team): TeamDto => ({
  id: team.id,
  name: team.name,
  created_at: team.createdAt,
});
