"use client";

import React from "react";
import * as WEBIFC from "web-ifc";
import * as BUI from "@thatopen/ui";
import * as OBC from "@thatopen/components";
import * as FRAGS from "@thatopen/fragments";
import * as OBCF from "@thatopen/components-front";

const Test = () => {
  const refContainer = React.useRef<HTMLDivElement>(null);

  const world = React.useRef<OBC.World>();
  const components = React.useRef<OBC.Components>();
  const fragmentLoader = React.useRef<OBC.IfcLoader>();
  const fragmentsManger = React.useRef<OBC.FragmentsManager>();
  const tiler = React.useRef<OBC.IfcGeometryTiler>();
  const propsTiler = React.useRef<OBC.IfcPropertiesTiler>();

  const geometryFileCount = React.useRef(1);
  const propsCounter = React.useRef(0);
  const files = React.useRef<{ name: string; bits: (Uint8Array | string)[] }[]>(
    []
  );
  const propsFiles = React.useRef<{ name: string; bits: Blob[] }[]>([]);

  const propsJSON = React.useRef<{
    types: { [type: number]: number[] };
    ids: { [id: string]: number };
    indexesFile: "small.ifc-processed-properties-indexes";
  }>({
    types: {},
    ids: {},
    indexesFile: "small.ifc-processed-properties-indexes",
  });

  const geometryData = React.useRef<OBC.StreamedGeometries>({});

  const assetData = React.useRef<OBC.StreamedAsset[]>([]);

  const loader = React.useRef<OBCF.IfcStreamer>();

  React.useEffect(() => {
    const comps = new OBC.Components();

    const worlds = comps.get(OBC.Worlds);

    const wrld = worlds.create<
      OBC.SimpleScene,
      OBC.SimpleCamera,
      OBC.SimpleRenderer
    >();

    wrld.scene = new OBC.SimpleScene(comps);

    if (refContainer.current) {
      wrld.scene = new OBC.SimpleScene(comps);
      wrld.renderer = new OBC.SimpleRenderer(comps, refContainer.current);
      wrld.camera = new OBC.SimpleCamera(comps);
    }

    comps.init();

    wrld.camera.controls.setLookAt(12, 6, 8, 0, 0, -10);

    wrld.scene.setup();

    const grids = comps.get(OBC.Grids);
    grids.create(wrld);
    wrld.scene.three.background = null;

    world.current = wrld;
    components.current = comps;

    // ifc loader part
    const fragLoader = comps.get(OBC.IfcLoader);

    fragLoader.setup();

    const excludedCats = [
      WEBIFC.IFCTENDONANCHOR,
      WEBIFC.IFCREINFORCINGBAR,
      WEBIFC.IFCREINFORCINGELEMENT,
    ];

    for (const cat of excludedCats) {
      fragLoader.settings.excludedCategories.add(cat);
    }

    fragLoader.settings.webIfc.COORDINATE_TO_ORIGIN = true;

    fragmentLoader.current = fragLoader;

    const fragManager = comps.get(OBC.FragmentsManager);

    fragManager.onFragmentsLoaded.add((model) => {
      console.log(model);
      exportFragments();
    });

    fragmentsManger.current = fragManager;
    const tler = comps.get(OBC.IfcGeometryTiler);
    const wasm = {
      path: "https://unpkg.com/web-ifc@0.0.57/",
      absolute: true,
    };

    tler.settings.wasm = wasm;
    tler.settings.minGeometrySize = 20;
    tler.settings.minAssetsSize = 1000;
    tler.onGeometryStreamed.add(async (geometry) => {
      const { buffer, data } = geometry;
      const bufferFileName = `small.ifc-processed-geometries-${geometryFileCount.current}`;
      for (const expressID in data) {
        const value = data[expressID];
        value.geometryFile = bufferFileName;
        geometryData.current[expressID] = value;
      }

      files.current.push({ name: bufferFileName, bits: [buffer] });
      geometryFileCount.current = geometryFileCount.current + 1;
    });

    tler.onAssetStreamed.add(async (assets) => {
      console.log(assets);
      assetData.current.push(...assets);
      console.log(assetData.current);
    });

    tler.onIfcLoaded.add(async (groupBuffer) => {
      files.current.push({
        name: "small.ifc-processed-global",
        bits: [groupBuffer],
      });
    });

    tler.onProgress.add(async (progress) => {
      console.log(progress);
      if (progress !== 1) return;
      setTimeout(async () => {
        const processedData = {
          assets: assetData.current,
          geometries: geometryData.current,
          globalDataFileId: "small.ifc-processed-global",
        };

        files.current.push({
          name: "small.ifc-processed.json",
          bits: [JSON.stringify(processedData)],
        });
        await downloadFilesSequentially(files.current);
      });
    });

    tiler.current = tler;

    const propsTler = comps.get(OBC.IfcPropertiesTiler);

    propsTler.settings.wasm = wasm;
    propsTler.onPropertiesStreamed.add(async (props) => {
      if (!propsJSON.current.types[props.type]) {
        propsJSON.current.types[props.type] = [];
      }
      propsJSON.current.types[props.type].push(propsCounter.current);

      for (const id in props.data) {
        propsJSON.current.ids[id] = propsCounter.current;
      }

      const name = `small.ifc-processed-properties-${propsCounter.current}`;
      const bits = [new Blob([JSON.stringify(props.data)])];
      propsFiles.current.push({ bits, name });

      propsCounter.current++;
    });

    propsTler.onProgress.add(async (progress) => {
      console.log(progress);
    });

    propsTler.onIndicesStreamed.add(async (props) => {
      propsFiles.current.push({
        name: `small.ifc-processed-properties.json`,
        bits: [new Blob([JSON.stringify(propsJSON.current)])],
      });

      const relations = comps.get(OBC.IfcRelationsIndexer);
      const serializedRels = relations.serializeRelations(props);

      propsFiles.current.push({
        name: "small.ifc-processed-properties-indexes",
        bits: [new Blob([serializedRels])],
      });

      await downloadFilesSequentially(propsFiles.current);
    });

    propsTiler.current = propsTler;

    const ldr = comps.get(OBCF.IfcStreamer);
    ldr.world = wrld;
    ldr.url = "/fragment/";
    loader.current = ldr;

    loadModel(
      "/fragment/small.ifc-processed.json",
      "/fragment/small.ifc-processed-properties.json"
    );
  }, []);

  async function loadModel(geometryURL: string, propertiesURL?: string) {
    const rawGeometryData = await fetch(geometryURL);
    const geometryData = await rawGeometryData.json();
    let propertiesData;
    if (propertiesURL) {
      const rawPropertiesData = await fetch(propertiesURL);
      propertiesData = await rawPropertiesData.json();
    }

    const model = await loader.current?.load(
      geometryData,
      true,
      propertiesData
    );
    console.log(model);
  }

  const loadIFC = async (file: File) => {
    if (!fragmentLoader.current) return;

    const data = await file.arrayBuffer();
    console.log(data);
    const buffer = new Uint8Array(data);
    console.log(buffer);
    return await fragmentLoader.current.load(buffer);

    // await tiler.current?.streamFromBuffer(buffer);
    // await propsTiler.current?.streamFromBuffer(buffer);
  };

  const addModelToScene = async (model: FRAGS.FragmentsGroup) => {
    world.current?.scene.three.add(model);
  };

  const onFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    if (!event.target.files) return;

    const file = event.target.files[0];
    const model = await loadIFC(file);

    if (model) {
      console.log("model loaded successfully");
      addModelToScene(model);
    }
  };

  function download(file: File) {
    const link = document.createElement("a");
    link.href = URL.createObjectURL(file);
    link.download = file.name;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  function downloadFile(name: string, ...bits: (Uint8Array | string | Blob)[]) {
    const file = new File(bits, name);
    const anchor = document.createElement("a");
    const url = URL.createObjectURL(file);
    anchor.href = url;
    anchor.download = file.name;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function downloadFilesSequentially(
    fileList: { name: string; bits: (Uint8Array | string | Blob)[] }[]
  ) {
    for (const { name, bits } of fileList) {
      downloadFile(name, ...bits);
      await new Promise((resolve) => {
        setTimeout(resolve, 100);
      });
    }
  }

  const exportFragments = () => {
    if (!fragmentsManger.current?.groups.size) {
      return;
    }
    const group = Array.from(fragmentsManger.current.groups.values())[0];
    const data = fragmentsManger.current.export(group);
    download(new File([new Blob([data])], "small.frag"));

    console.log(group.getLocalProperties());
    const properties = group.getLocalProperties();
    if (properties) {
      download(new File([JSON.stringify(properties)], "small.json"));
    }
  };

  return (
    <div>
      <input type="file" onChange={onFileChange} />s
      <div ref={refContainer}></div>
    </div>
  );
};

export default Test;
