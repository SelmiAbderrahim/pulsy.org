export interface PageSelectionPreview { statusPageId: string; title: string; slug: string; isPublished: boolean; currentCount: number; resultingCount: number; added: Array<{ id: string; publicName: string }>; alreadySelected: Array<{ id: string; publicName: string }>; revision: string }

export interface PageReplacementPreview extends PageSelectionPreview { components: Array<{ id: string; publicName: string }>; removed: Array<{ id: string; publicName: string }> }
