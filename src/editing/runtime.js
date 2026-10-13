export class RuntimeEditor {
  constructor(scene) {
    this.scene = scene;
  }
  
  appendPart(partData) {
    if (!this.scene) return null;
    const pack = this.getCurrentPack();
    if (pack) {
      pack.parts = pack.parts || [];
      pack.parts.push({
        name: partData.name || 'New Part',
        desc: partData.desc || '',
        color: partData.color || '#ffaa44',
        instances: partData.instances || []
      });
    }
    return partData;
  }
  
  getCurrentPack() {
    if (this.scene && this.scene.getPack) {
      return this.scene.getPack();
    }
    return null;
  }
}
