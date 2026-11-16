/**
 * Template Sets API client for editor
 */

import { apiClient } from './client'
import type { TemplateSet, Template } from '@storige/types'
import { withTemplateObjectIds } from '@/utils/templateObjectIds'

export interface TemplateSetWithDetails {
  templateSet: TemplateSet
  templateDetails: Template[]
}

export const templateSetsApi = {
  /**
   * 템플릿셋 상세 조회
   */
  getTemplateSet: async (id: string): Promise<TemplateSet> => {
    const response = await apiClient.get(`/template-sets/${id}`)
    return response.data
  },

  /**
   * 템플릿셋과 템플릿 상세 정보 조회
   */
  getTemplateSetWithTemplates: async (id: string): Promise<TemplateSetWithDetails> => {
    const response = await apiClient.get(`/template-sets/${id}/with-templates`)
    const data = response.data as TemplateSetWithDetails
    // id 가 없는 템플릿 객체에 정해진 id 를 채운다 — 페이지 템플릿 교체가 템플릿 요소를 가려내는 데 쓴다
    if (!data || !Array.isArray(data.templateDetails)) return data
    return { ...data, templateDetails: data.templateDetails.map((t) => withTemplateObjectIds(t)) }
  },
}
