(function() {
    const includePath = document.documentElement.dataset.headInclude;
    if (includePath) {
        fetch(includePath)
            .then(response => {
                if (!response.ok) {
                    console.error(`Failed to fetch include file: ${includePath}`);
                    return;
                }
                return response.text();
            })
            .then(data => {
                if (data) {
                    // Using insertAdjacentHTML to avoid destroying existing head elements like title
                    document.head.insertAdjacentHTML('beforeend', data);
                }
            });
    }
})();
