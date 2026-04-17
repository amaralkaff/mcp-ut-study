export interface LoginStatus {
  loggedIn: boolean;
  username?: string;
  fullName?: string;
}

export interface CourseSummary {
  id: string;
  name: string;
  url: string;
}

export interface SectionItem {
  name: string;
  type: string; // resource, url, quiz, forum, assign, attendance, page, folder, etc.
  url: string;
  modId?: string;
  summary?: string;
}

export interface CourseSection {
  sectionNumber: number;
  title: string;
  summary?: string;
  items: SectionItem[];
  url: string;
}

export interface MaterialContent {
  url: string;
  title: string;
  contentMarkdown: string;
  attachments: { name: string; url: string }[];
}

export interface AssessmentInfo {
  name: string;
  url: string;
  type: string;
  opens?: string;
  closes?: string;
  timeLimit?: string;
  attemptsAllowed?: string;
  attemptsUsed?: number;
  grade?: string;
}

export interface QuizQuestion {
  number: number;
  questionHtml: string;
  questionText: string;
  type: string; // multichoice, truefalse, shortanswer, essay, match, etc.
  options?: { label: string; text: string }[];
}

export interface AttendanceSession {
  date: string;
  time?: string;
  type?: string;
  description?: string;
  status?: string; // Present, Absent, Late, etc.
  remarks?: string;
}
