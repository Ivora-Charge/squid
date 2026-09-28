// Generated from the Squid charger compatibility worksheet. Keep alphabetized by brand.
export type ChargerModel = { model: string; guideUrl: string };
export type ChargerBrand = { brand: string; models: ChargerModel[] };

export const compatibleChargers: ChargerBrand[] = [
  {
    brand: "ABB",
    models: [
      {
        model: "Terra AC Wallbox - 40A",
        guideUrl:
          "https://new.abb.com/ev-charging/terra-ac-wallbox/digital-tools",
      },
      {
        model: "Terra AC Wallbox - 80A",
        guideUrl:
          "https://new.abb.com/ev-charging/terra-ac-wallbox/digital-tools",
      },
    ],
  },
  {
    brand: "Autel",
    models: [
      {
        model: "MaxiCharger AC Elite 50A",
        guideUrl:
          "https://askacharge.com/askacharge/en/blog/autel-ocpp-server-url.html",
      },
      {
        model: "MaxiCharger AC Ultra (Dual Port)",
        guideUrl:
          "https://manuals.plus/m/f26ec20aa1975e454ada74ae1028b58eaab69e8b43257919fb3d533925870b0e",
      },
      {
        model: "MaxiCharger AC Ultra (Single Port)",
        guideUrl:
          "https://manuals.plus/m/f26ec20aa1975e454ada74ae1028b58eaab69e8b43257919fb3d533925870b0e",
      },
    ],
  },
  {
    brand: "Delta Electronics",
    models: [
      {
        model: "AC Max",
        guideUrl:
          "https://chargehq.net/kb/delta-ac-max-smart-charger-configuration",
      },
    ],
  },
  {
    brand: "Eaton",
    models: [
      {
        model: "Eaton Smart Breaker",
        guideUrl:
          "https://device.report/m/924d413c661b3fd655342423c50e1d05246785db7487de0081fad40f41a4a8df",
      },
      {
        model: "Green Motion Building",
        guideUrl:
          "https://www.eaton.com/content/dam/eaton/products/emobility/ev-charging/na-eaton-ac-charging/green-motion-building-and-green-motion-fleet-commissioning-guide-IL191013EN.pdf",
      },
      {
        model: "Green Motion Building Pro",
        guideUrl:
          "https://www.eaton.com/content/dam/eaton/products/emobility/ev-charging/na-eaton-ac-charging/green-motion-building-and-green-motion-fleet-commissioning-guide-IL191013EN.pdf",
      },
      {
        model: "Green Motion Fleet",
        guideUrl:
          "https://www.eaton.com/content/dam/eaton/products/emobility/ev-charging/na-eaton-ac-charging/green-motion-building-and-green-motion-fleet-commissioning-guide-IL191013EN.pdf",
      },
      {
        model: "Green Motion Fleet Pro",
        guideUrl:
          "https://www.eaton.com/content/dam/eaton/products/emobility/ev-charging/na-eaton-ac-charging/green-motion-building-and-green-motion-fleet-commissioning-guide-IL191013EN.pdf",
      },
    ],
  },
  {
    brand: "EnergiSpot",
    models: [
      {
        model: "ATLEU1-32AAS",
        guideUrl: "https://www.energispot.com/evchargers",
      },
      {
        model: "ATLEU1-50AAS",
        guideUrl: "https://www.energispot.com/evchargers",
      },
      {
        model: "ATLUE1-80AAS",
        guideUrl: "https://www.energispot.com/evchargers",
      },
    ],
  },
  {
    brand: "Enphase",
    models: [
      {
        model: "IQ EV Charger 2",
        guideUrl:
          "https://support.enphase.com/s/article/faqs-for-iq-ev-charger-2-commercial-charging-overview",
      },
    ],
  },
  {
    brand: "EO",
    models: [
      {
        model: "Charging Genius",
        guideUrl: "https://www.eocharging.com/support",
      },
    ],
  },
  {
    brand: "Espen",
    models: [
      {
        model: "EVC/A48/J16/EWG 5D",
        guideUrl:
          "https://manuals.plus/m/c25de57c8c8e79e00f85d54c9cea91e63829eb3ac100cdc1d8b64eeebe0c9891",
      },
      {
        model: "EVC10/48AC",
        guideUrl:
          "https://manuals.plus/m/c25de57c8c8e79e00f85d54c9cea91e63829eb3ac100cdc1d8b64eeebe0c9891",
      },
      {
        model: "EVC10/80AC",
        guideUrl:
          "https://manuals.plus/m/c25de57c8c8e79e00f85d54c9cea91e63829eb3ac100cdc1d8b64eeebe0c9891",
      },
    ],
  },
  {
    brand: "Fractal EV",
    models: [
      {
        model: "FractalEV 48A",
        guideUrl:
          "https://fractalev.com/wp-content/uploads/2024/02/Quick-Start-Guide.pdf",
      },
      {
        model: "FractalEV 80A",
        guideUrl:
          "https://fractalev.com/wp-content/uploads/2024/02/Quick-Start-Guide.pdf",
      },
    ],
  },
  {
    brand: "Garo",
    models: [
      {
        model: "Entity Pro",
        guideUrl:
          "https://www.garoelectric.com/support/support-e-mobility/entity-pro/entity-manuals",
      },
    ],
  },
  {
    brand: "Grizzl-E",
    models: [
      {
        model: "Grizzl-E Smart Commercial Bundle",
        guideUrl:
          "https://askacharge.com/askacharge/en/blog/grizzl-e-ocpp-server-url.html",
      },
    ],
  },
  {
    brand: "HBE",
    models: [
      {
        model: "HBE-AC48A01HW-U-BHSAEW",
        guideUrl:
          "https://openchargealliance.org/participants/shenzhen-hb-electronics-co-ltd/",
      },
      {
        model: "HBE-AC48A01HW-U-SHEAED",
        guideUrl:
          "https://openchargealliance.org/participants/shenzhen-hb-electronics-co-ltd/",
      },
      {
        model: "HBE-AC48A01HW-U-SHSAED4GF",
        guideUrl:
          "https://openchargealliance.org/participants/shenzhen-hb-electronics-co-ltd/",
      },
    ],
  },
  {
    brand: "Iocharger",
    models: [
      {
        model: "IOCAH20",
        guideUrl: "https://www.iocharger.com/technical-documents/",
      },
    ],
  },
  {
    brand: "Joint",
    models: [
      {
        model: "Espen EVC 10 80A",
        guideUrl:
          "https://manuals.plus/m/c25de57c8c8e79e00f85d54c9cea91e63829eb3ac100cdc1d8b64eeebe0c9891",
      },
      {
        model: "EVC12/48AC",
        guideUrl:
          "https://www.manualslib.com/manual/3389533/Joint-Evc12-Series.html",
      },
      {
        model: "EVL007",
        guideUrl:
          "https://shop.swtchenergy.com/pages/swtch-home-charger-hardware",
      },
      {
        model: "JointTech Espen EVC 10 48A",
        guideUrl:
          "https://manuals.plus/m/c25de57c8c8e79e00f85d54c9cea91e63829eb3ac100cdc1d8b64eeebe0c9891",
      },
    ],
  },
  {
    brand: "Joint Tech",
    models: [
      {
        model: "EVC10/80AC",
        guideUrl:
          "https://manuals.plus/m/c25de57c8c8e79e00f85d54c9cea91e63829eb3ac100cdc1d8b64eeebe0c9891",
      },
      {
        model: "JNT-EVM002 48A",
        guideUrl:
          "https://manualzz.com/doc/html/80767105/joint-tech-evm002-series-electric-vehicle-ac-charger-user...",
      },
      {
        model: "JNT-EVM002 80A",
        guideUrl:
          "https://manualzz.com/doc/html/80767105/joint-tech-evm002-series-electric-vehicle-ac-charger-user...",
      },
    ],
  },
  {
    brand: "LEDVANCE",
    models: [
      {
        model: "EVM002 48A",
        guideUrl:
          "https://manualzz.com/doc/81542370/ledvance-evse-c2-electric-vehicle-ac-charger-user-manual",
      },
      {
        model: "EVM002 80A",
        guideUrl:
          "https://manualzz.com/doc/81542370/ledvance-evse-c2-electric-vehicle-ac-charger-user-manual",
      },
    ],
  },
  {
    brand: "Leviton",
    models: [
      {
        model: "Leviton EV48S-DP",
        guideUrl:
          "https://leviton.com/content/dam/leviton/commercial-industrial/product_documents/user_guide-manual/AmpUp%20Installer%20Quick%20Start%20Guide.pdf",
      },
      {
        model: "Leviton EV80S",
        guideUrl:
          "https://leviton.com/content/dam/leviton/commercial-industrial/product_documents/user_guide-manual/AmpUp%20Installer%20Quick%20Start%20Guide.pdf",
      },
    ],
  },
  {
    brand: "LG",
    models: [
      {
        model: "LG L2 EVW011SK-SL",
        guideUrl: "https://www.lg.com/us/support/product/lg-EVW011SK-SN.AUS",
      },
    ],
  },
  {
    brand: "Lite-On",
    models: [
      {
        model: "IC 32A",
        guideUrl:
          "https://chargelab.zendesk.com/hc/en-us/articles/38876495280283-Connect-Your-Lite-On-SC-IC3-to-ChargeLab",
      },
      {
        model: "IC 40A",
        guideUrl:
          "https://chargelab.zendesk.com/hc/en-us/articles/38876495280283-Connect-Your-Lite-On-SC-IC3-to-ChargeLab",
      },
      {
        model: "IC 80A",
        guideUrl:
          "https://chargelab.zendesk.com/hc/en-us/articles/38876495280283-Connect-Your-Lite-On-SC-IC3-to-ChargeLab",
      },
      {
        model: "SC 32A",
        guideUrl:
          "https://chargelab.zendesk.com/hc/en-us/articles/38876495280283-Connect-Your-Lite-On-SC-IC3-to-ChargeLab",
      },
      {
        model: "SC 40A",
        guideUrl:
          "https://chargelab.zendesk.com/hc/en-us/articles/38876495280283-Connect-Your-Lite-On-SC-IC3-to-ChargeLab",
      },
      {
        model: "SC 80A",
        guideUrl:
          "https://chargelab.zendesk.com/hc/en-us/articles/38876495280283-Connect-Your-Lite-On-SC-IC3-to-ChargeLab",
      },
    ],
  },
  {
    brand: "Phihong/Zerova",
    models: [
      {
        model: "Phihong/Zerova AW32",
        guideUrl:
          "https://help.noodoe.com/hc/en-us/articles/47105380312089-How-to-point-Zerova-EVSE-to-Noodoe-OCPP",
      },
      {
        model: "Phihong/Zerova AX48",
        guideUrl:
          "https://help.noodoe.com/hc/en-us/articles/47105380312089-How-to-point-Zerova-EVSE-to-Noodoe-OCPP",
      },
      {
        model: "Phihong/Zerova AX80",
        guideUrl:
          "https://help.noodoe.com/hc/en-us/articles/47105380312089-How-to-point-Zerova-EVSE-to-Noodoe-OCPP",
      },
    ],
  },
  {
    brand: "RAB",
    models: [
      {
        model: "EVC48",
        guideUrl:
          "https://www.rablighting.com/downloads/instructions/evc48_instructions.pdf",
      },
    ],
  },
  {
    brand: "Siemens",
    models: [
      {
        model: "Siemens VersiCharge",
        guideUrl:
          "https://support.industry.siemens.com/dl/files/636/109805636/att_1090710/v2/versicharge_wallbox_connectivity_guide_en-US_en-US.pdf",
      },
      {
        model: "VersiCharge Blue 80A",
        guideUrl:
          "https://support.industry.siemens.com/dl/files/636/109805636/att_1090710/v2/versicharge_wallbox_connectivity_guide_en-US_en-US.pdf",
      },
    ],
  },
  {
    brand: "Soneil",
    models: [
      {
        model: "Spark AC 48A",
        guideUrl: "https://soneilspark.com/pages/ac-commercial",
      },
      {
        model: "Spark AC 80A",
        guideUrl: "https://soneilspark.com/pages/ac-commercial",
      },
    ],
  },
  {
    brand: "TurnOnGreen",
    models: [
      {
        model: "EVP1100",
        guideUrl: "https://turnongreen.com/product-resources/",
      },
      {
        model: "EVP1900",
        guideUrl: "https://turnongreen.com/product-resources/",
      },
      {
        model: "EVP700",
        guideUrl: "https://turnongreen.com/product-resources/",
      },
    ],
  },
  {
    brand: "Wallbox",
    models: [
      {
        model: "WallBox Pulsar Plus(PUP1)",
        guideUrl:
          "https://support.wallbox.com/wp-content/uploads/ht_kb/2021/04/NA_OCPP_Activation_Manual.pdf",
      },
      {
        model: "WallBox Pulsar Plus(PUP2)",
        guideUrl:
          "https://support.wallbox.com/wp-content/uploads/ht_kb/2021/04/NA_OCPP_Activation_Manual.pdf",
      },
      {
        model: "Wallbox Pulsar Pro",
        guideUrl:
          "https://support.wallbox.com/wp-content/uploads/ht_kb/2021/04/NA_OCPP_Activation_Manual.pdf",
      },
    ],
  },
];
