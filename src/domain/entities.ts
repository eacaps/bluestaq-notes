export interface User {
  id: string;
  email: string;
  name: string;
  createdAt: string;
}

export interface Team {
  id: string;
  name: string;
  createdAt: string;
}

/** Entity data before the database assigns timestamps. */
export type NewUser = Omit<User, 'createdAt'>;
export type NewTeam = Omit<Team, 'createdAt'>;
export type NewNote = Omit<Note, 'createdAt' | 'updatedAt'>;

export interface Note {
  id: string;
  ownerId: string;
  title: string;
  body: string;
  teamIds: string[];
  createdAt: string;
  updatedAt: string;
}
