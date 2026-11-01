// Amateur radio bands (IARU Region 1), edges in Hz.
export const HAM_BANDS = [
    { name: '160 m', start: 1.810e6, stop: 2.000e6 },
    { name: '80 m', start: 3.500e6, stop: 3.800e6 },
    { name: '60 m', start: 5.3515e6, stop: 5.3665e6 },
    { name: '40 m', start: 7.000e6, stop: 7.200e6 },
    { name: '30 m', start: 10.100e6, stop: 10.150e6 },
    { name: '20 m', start: 14.000e6, stop: 14.350e6 },
    { name: '17 m', start: 18.068e6, stop: 18.168e6 },
    { name: '15 m', start: 21.000e6, stop: 21.450e6 },
    { name: '12 m', start: 24.890e6, stop: 24.990e6 },
    { name: '10 m', start: 28.000e6, stop: 29.700e6 },
    { name: '6 m', start: 50.000e6, stop: 52.000e6 },
    { name: '4 m', start: 70.000e6, stop: 70.500e6 },
    { name: '2 m', start: 144.000e6, stop: 146.000e6 },
    { name: '70 cm', start: 430.000e6, stop: 440.000e6 },
];

// sweep range for a band: the band with a margin on both sides so that its edges are visible
export const bandSweep = (band) => {
    const margin = (band.stop - band.start) * 0.15;
    return { start: band.start - margin, stop: band.stop + margin };
};
