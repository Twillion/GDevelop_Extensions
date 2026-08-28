# Twillion's Extensions

GDevelop extensions created by Twillion.

## Extensions

| Extension | Version | File |
| --- | :---: | --- |
| 3DCRT+ | 1.0.0 | `extensions/3DCRTplus.json` |
| 3D Game Post Processing Base | 0.1.0 | `extensions/GamePostProcess3D.json` |
| Advanced Materials | 1.3.1 | `extensions/AdvancedMaterials.json` |
| BRDF Materials | 3.2.0 | `extensions/BRDFMaterials_v3_2.json` |
| Extruded Sprite 3D | 0.3.6 | `extensions/ExtrudedSprite3D.json` |
| MIDI Synth Player | 1.0.0 | `extensions/MidiSynthPlayer.json` |
| Y-axis 3D Physics Character | 2.0.20 | `extensions/YAxisPhysicsCharacter3D.json` |

### Known broken

Both ship their behavior properties under the JSON key `properties`. GDevelop's serializer only reads
`propertyDescriptors`, so none of their properties exist at runtime and every `_get<Name>()` accessor
is undefined. Do not distribute until fixed.

| Extension | Version | File |
| --- | :---: | --- |
| Advanced 3D Material | 1.0.0 | `extensions/Advanced3DMaterial.json` |
| Soft Body 3D | 1.0.1 | `extensions/SoftBody3D.json` |

## Documentation

Supporting docs are in `docs/`.

## License

These extensions are released under the MIT License. See `LICENSE`.
