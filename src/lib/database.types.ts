export type CompanyRole = 'owner' | 'manager' | 'operator'
export type MemberStatus = 'active' | 'invited' | 'suspended'
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          full_name: string | null
          created_at: string
        }
        Insert: {
          id: string
          full_name?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          full_name?: string | null
          created_at?: string
        }
        Relationships: []
      }
      companies: {
        Row: {
          id: string
          legal_name: string
          trade_name: string | null
          cnpj: string | null
          created_by: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          legal_name: string
          trade_name?: string | null
          cnpj?: string | null
          created_by: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          legal_name?: string
          trade_name?: string | null
          cnpj?: string | null
          created_by?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      company_members: {
        Row: {
          company_id: string
          user_id: string
          role: CompanyRole
          status: MemberStatus
          created_at: string
        }
        Insert: {
          company_id: string
          user_id: string
          role: CompanyRole
          status?: MemberStatus
          created_at?: string
        }
        Update: {
          company_id?: string
          user_id?: string
          role?: CompanyRole
          status?: MemberStatus
          created_at?: string
        }
        Relationships: []
      }
      product_categories: {
        Row: {
          id: string
          company_id: string
          name: string
          active: boolean
          sort_order: number
          created_at: string
        }
        Insert: {
          id?: string
          company_id: string
          name: string
          active?: boolean
          sort_order?: number
          created_at?: string
        }
        Update: {
          id?: string
          company_id?: string
          name?: string
          active?: boolean
          sort_order?: number
          created_at?: string
        }
        Relationships: []
      }
      products: {
        Row: {
          id: string
          company_id: string
          category_id: string
          code: string | null
          name: string
          cost: number | null
          price: number
          current_stock: number
          stock_min: number | null
          stock_max: number | null
          observations: string
          promotion: { qtd: number; preco: number } | null
          active: boolean
          created_by: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          company_id: string
          category_id: string
          code?: string | null
          name: string
          cost?: number | null
          price?: number
          current_stock?: number
          stock_min?: number | null
          stock_max?: number | null
          observations?: string
          promotion?: { qtd: number; preco: number } | null
          active?: boolean
          created_by: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          company_id?: string
          category_id?: string
          code?: string | null
          name?: string
          cost?: number | null
          price?: number
          current_stock?: number
          stock_min?: number | null
          stock_max?: number | null
          observations?: string
          promotion?: { qtd: number; preco: number } | null
          active?: boolean
          created_by?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      stock_movements: {
        Row: {
          id: string
          company_id: string
          product_id: string
          type: string
          direction: number
          quantity: number
          unit_cost: number | null
          occurred_at: string
          observations: string
          origin: 'manual' | 'system' | 'initial' | 'sale'
          reference_id: string | null
          created_by: string
          created_at: string
        }
        Insert: {
          id?: string
          company_id: string
          product_id: string
          type: string
          direction: number
          quantity: number
          unit_cost?: number | null
          occurred_at?: string
          observations?: string
          origin: 'manual' | 'system' | 'initial' | 'sale'
          reference_id?: string | null
          created_by: string
          created_at?: string
        }
        Update: {
          id?: string
          company_id?: string
          product_id?: string
          type?: string
          direction?: number
          quantity?: number
          unit_cost?: number | null
          occurred_at?: string
          observations?: string
          origin?: 'manual' | 'system' | 'initial' | 'sale'
          reference_id?: string | null
          created_by?: string
          created_at?: string
        }
        Relationships: []
      }
      customers: {
        Row: {
          id: string
          company_id: string
          full_name: string
          cpf: string | null
          phone: string | null
          birth_date: string | null
          street: string | null
          address_number: string | null
          neighborhood: string | null
          city: string | null
          observations: string
          custom_fields: Record<string, unknown>
          last_contact_at: string | null
          archived_at: string | null
          created_by: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          company_id: string
          full_name: string
          cpf?: string | null
          phone?: string | null
          birth_date?: string | null
          street?: string | null
          address_number?: string | null
          neighborhood?: string | null
          city?: string | null
          observations?: string
          custom_fields?: Record<string, unknown>
          last_contact_at?: string | null
          archived_at?: string | null
          created_by: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          company_id?: string
          full_name?: string
          cpf?: string | null
          phone?: string | null
          birth_date?: string | null
          street?: string | null
          address_number?: string | null
          neighborhood?: string | null
          city?: string | null
          observations?: string
          custom_fields?: Record<string, unknown>
          last_contact_at?: string | null
          archived_at?: string | null
          created_by?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      customer_notes: {
        Row: {
          id: string
          company_id: string
          customer_id: string
          content: string
          attended_by: string
          created_by: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          company_id: string
          customer_id: string
          content: string
          attended_by?: string
          created_by: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          company_id?: string
          customer_id?: string
          content?: string
          attended_by?: string
          created_by?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      customer_procurations: {
        Row: {
          id: string
          company_id: string
          customer_id: string
          category_id: string | null
          description: string
          details: string
          status: 'open' | 'fulfilled' | 'abandoned'
          occurred_on: string
          resolved_at: string | null
          created_by: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          company_id: string
          customer_id: string
          category_id?: string | null
          description: string
          details?: string
          status?: 'open' | 'fulfilled' | 'abandoned'
          occurred_on?: string
          resolved_at?: string | null
          created_by: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          company_id?: string
          customer_id?: string
          category_id?: string | null
          description?: string
          details?: string
          status?: 'open' | 'fulfilled' | 'abandoned'
          occurred_on?: string
          resolved_at?: string | null
          created_by?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      customer_contacts: {
        Row: {
          id: string
          company_id: string
          customer_id: string
          channel: 'whatsapp'
          context: 'general' | 'reactivation' | 'procure' | 'birthday'
          created_by: string
          contacted_at: string
        }
        Insert: {
          id?: string
          company_id: string
          customer_id: string
          channel: 'whatsapp'
          context: 'general' | 'reactivation' | 'procure' | 'birthday'
          created_by: string
          contacted_at?: string
        }
        Update: {
          id?: string
          company_id?: string
          customer_id?: string
          channel?: 'whatsapp'
          context?: 'general' | 'reactivation' | 'procure' | 'birthday'
          created_by?: string
          contacted_at?: string
        }
        Relationships: []
      }
      customer_settings: {
        Row: {
          company_id: string
          inactive_days: number
          whatsapp_message: string
          birthday_message: string
          procure_message: string
          created_at: string
          updated_at: string
        }
        Insert: {
          company_id: string
          inactive_days?: number
          whatsapp_message?: string
          birthday_message?: string
          procure_message?: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          company_id?: string
          inactive_days?: number
          whatsapp_message?: string
          birthday_message?: string
          procure_message?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      cash_registers: {
        Row: {
          id: string
          company_id: string
          status: 'open' | 'closed'
          opening_cash: number
          opened_at: string
          opened_by: string
          operator_name: string
          closed_at: string | null
          closed_by: string | null
          expected_cash: number | null
          counted_cash: number | null
          difference: number | null
          closing_note: string
          created_at: string
        }
        Insert: {
          id?: string
          company_id: string
          status?: 'open' | 'closed'
          opening_cash?: number
          opened_at?: string
          opened_by: string
          operator_name?: string
          closed_at?: string | null
          closed_by?: string | null
          expected_cash?: number | null
          counted_cash?: number | null
          difference?: number | null
          closing_note?: string
          created_at?: string
        }
        Update: {
          id?: string
          company_id?: string
          status?: 'open' | 'closed'
          opening_cash?: number
          opened_at?: string
          opened_by?: string
          operator_name?: string
          closed_at?: string | null
          closed_by?: string | null
          expected_cash?: number | null
          counted_cash?: number | null
          difference?: number | null
          closing_note?: string
          created_at?: string
        }
        Relationships: []
      }
      sales: {
        Row: {
          id: string
          company_id: string
          sale_number: number
          cash_register_id: string
          customer_id: string | null
          seller_name: string
          status: 'active' | 'cancelled'
          sold_at: string
          subtotal: number
          promotion_discount: number
          item_discount: number
          sale_discount: number
          total_discount: number
          total: number
          received: number
          change_due: number
          sale_discount_type: 'amount' | 'percent'
          sale_discount_value: number
          sale_discount_reason: string
          observations: string
          cancelled_at: string | null
          cancelled_by: string | null
          cancellation_reason: string
          updated_at: string
          created_by: string
          updated_by: string
        }
        Insert: {
          id?: string
          company_id: string
          sale_number: number
          cash_register_id: string
          customer_id?: string | null
          seller_name: string
          status?: 'active' | 'cancelled'
          sold_at?: string
          subtotal?: number
          promotion_discount?: number
          item_discount?: number
          sale_discount?: number
          total_discount?: number
          total?: number
          received?: number
          change_due?: number
          sale_discount_type?: 'amount' | 'percent'
          sale_discount_value?: number
          sale_discount_reason?: string
          observations?: string
          cancelled_at?: string | null
          cancelled_by?: string | null
          cancellation_reason?: string
          updated_at?: string
          created_by: string
          updated_by: string
        }
        Update: {
          id?: string
          company_id?: string
          sale_number?: number
          cash_register_id?: string
          customer_id?: string | null
          seller_name?: string
          status?: 'active' | 'cancelled'
          sold_at?: string
          subtotal?: number
          promotion_discount?: number
          item_discount?: number
          sale_discount?: number
          total_discount?: number
          total?: number
          received?: number
          change_due?: number
          sale_discount_type?: 'amount' | 'percent'
          sale_discount_value?: number
          sale_discount_reason?: string
          observations?: string
          cancelled_at?: string | null
          cancelled_by?: string | null
          cancellation_reason?: string
          updated_at?: string
          created_by?: string
          updated_by?: string
        }
        Relationships: []
      }
      sale_items: {
        Row: {
          id: string
          company_id: string
          sale_id: string
          product_id: string
          product_name: string
          product_code: string | null
          category_name: string
          quantity: number
          unit_price: number
          unit_cost: number | null
          promotion_quantity: number | null
          promotion_price: number | null
          promotion_active: boolean
          promotion_discount: number
          discount_type: 'amount' | 'percent'
          discount_value: number
          discount_reason: string
          subtotal: number
          item_discount: number
          total: number
        }
        Insert: {
          id?: string
          company_id: string
          sale_id: string
          product_id: string
          product_name: string
          product_code?: string | null
          category_name?: string
          quantity: number
          unit_price: number
          unit_cost?: number | null
          promotion_quantity?: number | null
          promotion_price?: number | null
          promotion_active?: boolean
          promotion_discount?: number
          discount_type?: 'amount' | 'percent'
          discount_value?: number
          discount_reason?: string
          subtotal: number
          item_discount?: number
          total: number
        }
        Update: {
          id?: string
          company_id?: string
          sale_id?: string
          product_id?: string
          product_name?: string
          product_code?: string | null
          category_name?: string
          quantity?: number
          unit_price?: number
          unit_cost?: number | null
          promotion_quantity?: number | null
          promotion_price?: number | null
          promotion_active?: boolean
          promotion_discount?: number
          discount_type?: 'amount' | 'percent'
          discount_value?: number
          discount_reason?: string
          subtotal?: number
          item_discount?: number
          total?: number
        }
        Relationships: []
      }
      sale_payments: {
        Row: {
          id: string
          company_id: string
          sale_id: string
          payment_method: 'cash' | 'pix' | 'credit' | 'debit' | 'other'
          payment_label: string
          amount: number
        }
        Insert: {
          id?: string
          company_id: string
          sale_id: string
          payment_method: 'cash' | 'pix' | 'credit' | 'debit' | 'other'
          payment_label: string
          amount: number
        }
        Update: {
          id?: string
          company_id?: string
          sale_id?: string
          payment_method?: 'cash' | 'pix' | 'credit' | 'debit' | 'other'
          payment_label?: string
          amount?: number
        }
        Relationships: []
      }
    }
    Views: Record<string, never>
    Functions: {
      create_company: {
        Args: {
          p_legal_name: string
          p_trade_name: string | null
          p_cnpj: string | null
        }
        Returns: string
      }
      has_company_role: {
        Args: {
          p_company_id: string
          p_roles: string[]
        }
        Returns: boolean
      }
      is_company_member: {
        Args: {
          p_company_id: string
        }
        Returns: boolean
      }
      register_stock_movement: {
        Args: {
          p_company_id: string
          p_product_id: string
          p_type: string
          p_direction: number
          p_quantity: number
          p_unit_cost: number | null
          p_occurred_at: string
          p_observations: string
          p_origin?: string
          p_update_product_cost?: boolean
        }
        Returns: string
      }
      update_stock_movement: {
        Args: {
          p_company_id: string
          p_movement_id: string
          p_product_id: string
          p_type: string
          p_direction: number
          p_quantity: number
          p_unit_cost: number | null
          p_occurred_at: string
          p_observations: string
          p_update_product_cost?: boolean
        }
        Returns: undefined
      }
      delete_stock_movement: {
        Args: {
          p_company_id: string
          p_movement_id: string
        }
        Returns: undefined
      }
      record_customer_contact: {
        Args: {
          p_company_id: string
          p_customer_id: string
          p_context?: string
        }
        Returns: string
      }
      set_customer_archived: {
        Args: {
          p_company_id: string
          p_customer_id: string
          p_archived: boolean
        }
        Returns: undefined
      }
      open_cash_register: {
        Args: {
          p_company_id: string
          p_opening_cash: number
          p_operator_name?: string
        }
        Returns: string
      }
      close_cash_register: {
        Args: {
          p_company_id: string
          p_cash_register_id: string
          p_counted_cash: number
          p_closing_note?: string
        }
        Returns: undefined
      }
      save_sale: {
        Args: {
          p_company_id: string
          p_cash_register_id: string
          p_sale_id: string | null
          p_customer_id: string | null
          p_seller_name: string
          p_items: Json
          p_payments: Json
          p_sale_discount_type: string
          p_sale_discount_value: number
          p_sale_discount_reason: string
          p_observations: string
          p_sold_at: string
          p_allow_negative_stock?: boolean
        }
        Returns: Json
      }
      cancel_sale: {
        Args: {
          p_company_id: string
          p_sale_id: string
          p_reason?: string
        }
        Returns: undefined
      }
      reactivate_sale: {
        Args: {
          p_company_id: string
          p_sale_id: string
          p_allow_negative_stock?: boolean
        }
        Returns: undefined
      }
    }
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}
