// M2.3 Project ZIP portability — types.

export type ProjectExportResponse = {
  project_id: string;
  zip_path: string;
  bytes_written: number;
};

export type ProjectImportResponse = {
  project_id: string;
  warnings: string[];
};
