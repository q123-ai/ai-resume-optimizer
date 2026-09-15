export type ParseResumeResponse =
  | {
      success: true;
      fileName: string;
      fileType: "pdf" | "docx";
      text: string;
      characterCount: number;
    }
  | { success: false; error: string };
