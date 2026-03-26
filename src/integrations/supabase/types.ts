export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      assignments: {
        Row: {
          anti_cheat: boolean | null
          created_at: string
          grading_scale: Json
          group_id: number
          id: number
          lobby_started_at: string | null
          question_data: Json
          status: string
          teacher_id: string
          template_id: number | null
          time_limit: number | null
          timing_mode: string | null
          title: string
          window_end: string | null
          window_start: string | null
        }
        Insert: {
          anti_cheat?: boolean | null
          created_at?: string
          grading_scale?: Json
          group_id: number
          id?: number
          lobby_started_at?: string | null
          question_data?: Json
          status?: string
          teacher_id: string
          template_id?: number | null
          time_limit?: number | null
          timing_mode?: string | null
          title: string
          window_end?: string | null
          window_start?: string | null
        }
        Update: {
          anti_cheat?: boolean | null
          created_at?: string
          grading_scale?: Json
          group_id?: number
          id?: number
          lobby_started_at?: string | null
          question_data?: Json
          status?: string
          teacher_id?: string
          template_id?: number | null
          time_limit?: number | null
          timing_mode?: string | null
          title?: string
          window_end?: string | null
          window_start?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "assignments_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignments_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "templates"
            referencedColumns: ["id"]
          },
        ]
      }
      groups: {
        Row: {
          count: number
          created_at: string
          id: number
          name: string
          subject: string
          teacher_id: string
          usernames: Json
        }
        Insert: {
          count?: number
          created_at?: string
          id?: number
          name: string
          subject?: string
          teacher_id: string
          usernames?: Json
        }
        Update: {
          count?: number
          created_at?: string
          id?: number
          name?: string
          subject?: string
          teacher_id?: string
          usernames?: Json
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          email: string | null
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          id: string
          name?: string
        }
        Update: {
          created_at?: string
          email?: string | null
          id?: string
          name?: string
        }
        Relationships: []
      }
      students: {
        Row: {
          created_at: string
          group_id: number
          id: number
          pin: string
          username: string
        }
        Insert: {
          created_at?: string
          group_id: number
          id?: number
          pin?: string
          username: string
        }
        Update: {
          created_at?: string
          group_id?: number
          id?: number
          pin?: string
          username?: string
        }
        Relationships: [
          {
            foreignKeyName: "students_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
        ]
      }
      submissions: {
        Row: {
          ai_corrections: Json | null
          answers: Json
          assignment_id: number
          grade: string | null
          id: number
          manual_overrides: Json | null
          reviewed: boolean | null
          score: number | null
          student_id: number | null
          submitted_at: string
          total_points: number | null
          username: string | null
        }
        Insert: {
          ai_corrections?: Json | null
          answers?: Json
          assignment_id: number
          grade?: string | null
          id?: number
          manual_overrides?: Json | null
          reviewed?: boolean | null
          score?: number | null
          student_id?: number | null
          submitted_at?: string
          total_points?: number | null
          username?: string | null
        }
        Update: {
          ai_corrections?: Json | null
          answers?: Json
          assignment_id?: number
          grade?: string | null
          id?: number
          manual_overrides?: Json | null
          reviewed?: boolean | null
          score?: number | null
          student_id?: number | null
          submitted_at?: string
          total_points?: number | null
          username?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "submissions_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "submissions_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      templates: {
        Row: {
          anti_cheat: boolean | null
          created_at: string
          description: string | null
          grade_level: string | null
          grading_scale: Json
          id: number
          question_data: Json
          subject: string | null
          teacher_id: string
          time_limit: number | null
          title: string
        }
        Insert: {
          anti_cheat?: boolean | null
          created_at?: string
          description?: string | null
          grade_level?: string | null
          grading_scale?: Json
          id?: number
          question_data?: Json
          subject?: string | null
          teacher_id: string
          time_limit?: number | null
          title?: string
        }
        Update: {
          anti_cheat?: boolean | null
          created_at?: string
          description?: string | null
          grade_level?: string | null
          grading_scale?: Json
          id?: number
          question_data?: Json
          subject?: string | null
          teacher_id?: string
          time_limit?: number | null
          title?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
